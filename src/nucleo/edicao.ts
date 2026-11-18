// Edição e renderização: monta a timeline do plano aprovado, aplica as alterações do
// usuário guardando cada versão, e gerencia as tarefas de render (fila, progresso,
// cancelamento, nova tentativa e histórico de exportações).

import { copyFileSync as copiarArquivo, existsSync as existe, mkdirSync as criarPasta } from "node:fs";
import { aplicarMarca, type RetratoDaMarca } from "../dominio/marca-na-timeline.ts";
import type { ServicoMarcas } from "../servicos/marcas.ts";
import type { EventEmitter } from "node:events";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgenteDeEdicao } from "../../Pipeline/editing/montagem.ts";
import type { Material } from "../../Pipeline/editing/planejamento.ts";
import { AgenteDeArquivos } from "../../Pipeline/ingestion/arquivos.ts";
import { moverArquivo, RenderCancelado, renderizarTimeline, type Cancelamento, type PedidoDeRender } from "../../Pipeline/rendering/motor.ts";
import { ErroAplicacao } from "../dominio/erros.ts";
import type { AnaliseDeConteudo, ArquivoBruto, Decisao, PlanoDeEdicao, Roteiro } from "../dominio/producao.ts";
import type { Exportacao, ItemAudio, Operacao, Timeline, VersaoDaTimeline } from "../dominio/timeline.ts";
import { agora } from "../infra/banco.ts";
import type { Caminhos } from "../infra/caminhos.ts";
import type { ServicoAcervo } from "../servicos/acervo.ts";
import type { ServicoAprendizado } from "../servicos/aprendizado.ts";
import type { ServicoEstilos } from "../servicos/estilos.ts";
import type { ServicoMemoria } from "../servicos/memoria.ts";
import type { ServicoProjetos } from "../servicos/projetos.ts";
import type { Hardware } from "../servicos/recursos.ts";
import { aplicarOperacao, descreverOperacao, normalizarTimeline, type ServicoTimeline } from "../servicos/timeline.ts";
import type { ServicoDeQualidade } from "../servicos/qualidade.ts";
import type { Producao } from "./producao.ts";
import { processoVivo } from "../infra/instancia.ts";
import { resumoDoRelatorio, type Qualidade } from "./qualidade.ts";

export interface DependenciasDaEdicao {
  caminhos: Caminhos;
  marcas: ServicoMarcas;
  projetos: ServicoProjetos;
  acervo: ServicoAcervo;
  aprendizado: ServicoAprendizado;
  memoria: ServicoMemoria;
  estilos: ServicoEstilos;
  timelines: ServicoTimeline;
  producao: Producao;
  hardware: Hardware;
  eventos: EventEmitter;
  qualidade: Qualidade;
  catalogo: ServicoDeQualidade;
}

export interface OpcoesDeExportacao {
  /** Versão da timeline. Por padrão, a atual. */
  versao?: number;
  /** Preset de exportação (resolução, taxa de quadros e qualidade). */
  preset?: string;
  /** Perfil de qualidade do destino. Por padrão, é escolhido pela plataforma e pelo formato. */
  perfilDeQualidade?: string;
}

export interface TarefaDeRender {
  exportacao: Exportacao;
  /** Resolve quando a tarefa termina, seja qual for o resultado (concluída, falha ou cancelada). */
  conclusao: Promise<Exportacao>;
}

export class Edicao {
  agente = new AgenteDeEdicao();
  private d: DependenciasDaEdicao;
  private fila: Promise<unknown> = Promise.resolve();
  private emAndamento = new Map<number, Cancelamento>();

  constructor(dependencias: DependenciasDaEdicao) {
    this.d = dependencias;
  }

  // --- Timeline -----------------------------------------------------------------------

  /** Monta a timeline a partir do plano aprovado, no(s) estilo(s) escolhido(s). Exige plano aprovado. */
  montar(projetoId: string, opcoes: { estilos?: string[] } = {}): VersaoDaTimeline & { decisoes: Decisao[]; avisos: string[] } {
    const projeto = this.d.projetos.obter(projetoId);
    const plano = this.d.producao.exigirPlanoAprovado(projetoId);
    const { estilo, divergencias } = this.d.estilos.combinar(opcoes.estilos ?? []);
    const materiais: Material[] = this.d.projetos.midias(projetoId, "bruto").flatMap((midia) => {
      const arquivo = this.d.acervo.analises({ midiaId: midia.id }, "arquivo")[0]?.resultado as ArquivoBruto | undefined;
      const conteudo = this.d.acervo.analises({ midiaId: midia.id }, "conteudo")[0]?.resultado as AnaliseDeConteudo | undefined;
      return arquivo && conteudo ? [{ midiaId: midia.id, arquivo, conteudo }] : [];
    });
    const montagem = this.agente.montar({
      plano: plano.plano as PlanoDeEdicao,
      estilo,
      materiais,
      aprendizados: this.d.aprendizado.consultar({ projetoId, perfis: [projeto.perfil] }).aplicaveis,
      estilosDeReferencia: this.d.acervo
        .referencias(projetoId)
        .map((r) => this.d.acervo.analises({ referenciaId: r.id }, "perfil-de-estilo")[0]?.resultado as Record<string, string> | undefined)
        .filter((x): x is Record<string, string> => Boolean(x)),
      roteiro: this.d.memoria.recordar<Roteiro>(`projeto:${projetoId}`, "roteiro"),
      nomeDoProjeto: projeto.nome,
    });
    // Textos e legendas já nascem dentro da área segura do destino do vídeo.
    const destino = this.d.qualidade.perfilPara(projetoId, montagem.timeline.formato);
    const { topo, base, lados } = destino.areaSegura;
    montagem.timeline.areaSegura = { topo, base, lados };
    montagem.decisoes.push({ aspecto: "area-segura", decisao: `margens do destino ${destino.nome}`, origem: "perfil" });
    // A marca do projeto (só pronta), com os arquivos copiados para o projeto: retrato que não muda sozinho.
    const retrato = this.retratoDaMarca(projetoId);
    if (retrato) {
      const comMarca = aplicarMarca(montagem.timeline, retrato);
      montagem.timeline = comMarca.timeline;
      montagem.decisoes.push(...comMarca.decisoes);
    } else if (projeto.configuracao.marca) {
      montagem.avisos.push("A marca escolhida para o projeto não está pronta: o vídeo foi montado sem ela.");
    }
    const versao = this.d.timelines.salvar(projetoId, normalizarTimeline(montagem.timeline), "ia", `Montada do plano v${plano.versao} no estilo ${estilo.nome}`);
    this.d.memoria.lembrar(`projeto:${projetoId}`, "montagem", { versao: versao.versao, estilo: estilo.id, decisoes: montagem.decisoes });
    return { ...versao, decisoes: montagem.decisoes, avisos: [...divergencias, ...montagem.avisos] };
  }

  /**
   * Retrato da marca pronta do projeto, com logo e fontes copiados para a pasta do projeto
   * (uma pasta por versão da marca). null sem marca ou com marca ainda em rascunho.
   */
  private retratoDaMarca(projetoId: string): RetratoDaMarca | null {
    const id = this.d.projetos.obter(projetoId).configuracao.marca;
    if (!id) return null;
    const marca = this.marcaOuNada(id);
    if (!marca || marca.estado !== "pronta") return null;
    const pasta = path.join(this.d.caminhos.projetos, projetoId, "marca", marca.atualizadaEm.replace(/\D/g, ""));
    criarPasta(pasta, { recursive: true });
    const copiar = (arquivo: string | null): string | null => {
      if (!arquivo || !existe(arquivo)) return null;
      const destino = path.join(pasta, path.basename(arquivo));
      if (!existe(destino)) copiarArquivo(arquivo, destino);
      return destino;
    };
    const fonte = (f: (typeof marca.fontes)["titulos"]) => (f ? { ...f, arquivos: f.arquivos.map((a) => copiar(a)).filter((a): a is string => a !== null) } : null);
    return {
      id: marca.id, atualizadaEm: marca.atualizadaEm, logo: copiar(marca.logo), logoClaro: copiar(marca.logoClaro), logoPosicao: marca.logoPosicao, cores: marca.cores,
      fontes: { titulos: fonte(marca.fontes.titulos), texto: fonte(marca.fontes.texto) },
    };
  }

  /** A marca, ou null se ela não existe mais (o projeto aponta para uma marca apagada). */
  private marcaOuNada(id: string) {
    try {
      return this.d.marcas.obter(id);
    } catch {
      return null;
    }
  }

  /** A marca do projeto mudou (ou foi trocada/tirada) depois da montagem da timeline atual. */
  marcaDesatualizada(projetoId: string): boolean {
    let atual: Timeline;
    try {
      atual = this.timeline(projetoId).timeline;
    } catch {
      return false; // ainda sem timeline
    }
    const id = this.d.projetos.obter(projetoId).configuracao.marca;
    if (!id) return Boolean(atual.marca);
    const marca = this.marcaOuNada(id);
    if (!marca) return Boolean(atual.marca); // marca apagada: o vídeo pode ficar sem ela
    if (marca.estado !== "pronta") return false;
    return atual.marca?.id !== marca.id || atual.marca.atualizadaEm !== marca.atualizadaEm;
  }

  /** Troca o que veio da marca pela versão atual dela (ou tira, se o projeto ficou sem marca), sem perder edições manuais. */
  aplicarMarcaAtual(projetoId: string): VersaoDaTimeline {
    return this.editar(projetoId, { tipo: "aplicar-marca", marca: this.retratoDaMarca(projetoId) }, "Aplicada a marca atual");
  }

  timeline(projetoId: string, versao?: number): VersaoDaTimeline {
    return this.d.timelines.obter(projetoId, versao);
  }

  historico(projetoId: string): VersaoDaTimeline[] {
    return this.d.timelines.historico(projetoId);
  }

  /** Aplica uma ou mais operações à timeline atual e salva o resultado como nova versão. */
  editar(projetoId: string, operacoes: Operacao | Operacao[], nota?: string): VersaoDaTimeline {
    const lista = Array.isArray(operacoes) ? operacoes : [operacoes];
    const timeline = lista.reduce((t, op) => aplicarOperacao(t, op), this.timeline(projetoId).timeline);
    return this.d.timelines.salvar(projetoId, timeline, "usuario", nota ?? lista.map(descreverOperacao).join("; "));
  }

  /** Volta a uma versão anterior criando uma versão nova com o mesmo conteúdo. Sem número, desfaz a última alteração. */
  restaurar(projetoId: string, versao?: number): VersaoDaTimeline {
    const atual = this.timeline(projetoId);
    const alvo = versao ?? atual.versao - 1;
    if (alvo < 1) throw new ErroAplicacao("sem-versao-anterior", "Não há versão anterior da timeline para restaurar.");
    return this.d.timelines.salvar(projetoId, this.timeline(projetoId, alvo).timeline, "usuario", `Restaurada a versão ${alvo}`);
  }

  /** Acrescenta (ou troca) a trilha sonora da timeline, baixando o volume durante as falas. */
  definirTrilha(projetoId: string, arquivo: string, volume = 0.6): VersaoDaTimeline {
    if (!existsSync(arquivo)) throw new ErroAplicacao("arquivo-nao-encontrado", `Arquivo de áudio não encontrado: ${arquivo}`);
    const timeline = this.timeline(projetoId).timeline;
    const trilha: ItemAudio = {
      id: "trilha", tipo: "audio", papel: "trilha", camada: 0, arquivo: path.resolve(arquivo), inicioSeg: 0, duracaoSeg: timeline.duracaoSeg, inicioOrigemSeg: 0,
      volume, fadeDeEntradaSeg: 0.3, fadeDeSaidaSeg: Math.min(1.5, timeline.duracaoSeg / 4),
      reduzirEm: timeline.itens.filter((i) => i.tipo === "legenda").map((i) => ({ inicioSeg: i.inicioSeg, fimSeg: i.inicioSeg + i.duracaoSeg })),
      volumeReduzido: volume * 0.3,
    };
    const operacoes: Operacao[] = [...(timeline.itens.some((i) => i.id === "trilha") ? [{ tipo: "remover" as const, id: "trilha" }] : []), { tipo: "inserir", item: trilha }];
    return this.editar(projetoId, operacoes, `Trilha sonora: ${path.basename(arquivo)}`);
  }

  // --- Renderização ---------------------------------------------------------------------

  /** Prévia de baixa qualidade: um terço da resolução, codificação rápida. Não passa pelo controle de qualidade completo. */
  previa(projetoId: string, versao?: number): TarefaDeRender {
    return this.renderizar(projetoId, "previa", { versao });
  }

  /**
   * Exportação final em MP4 (H.264 + AAC), na pasta Exportações/. A timeline é conferida
   * antes do render e o arquivo, depois dele; um vídeo reprovado não vai para Exportações/.
   */
  exportar(projetoId: string, opcoes: OpcoesDeExportacao = {}): TarefaDeRender {
    return this.renderizar(projetoId, "final", opcoes);
  }

  private renderizar(projetoId: string, tipo: "previa" | "final", opcoes: OpcoesDeExportacao): TarefaDeRender {
    this.d.producao.exigirPlanoAprovado(projetoId);
    const alvo = this.timeline(projetoId, opcoes.versao);
    if (opcoes.preset) this.ajustesDoPreset(alvo.timeline, opcoes.preset); // recusa já um preset incompatível
    const exportacao = this.d.timelines.criarExportacao(projetoId, alvo.versao, tipo, opcoes.preset ?? null);
    // Um render de cada vez: renderizar em paralelo disputaria CPU, memória e GPU.
    const conclusao = this.fila.then(() => this.executar(exportacao.id, alvo, opcoes.perfilDeQualidade));
    this.fila = conclusao.catch(() => undefined);
    return { exportacao, conclusao };
  }

  /** Traduz um preset em ajustes de render. O preset precisa ter a mesma proporção da timeline. */
  private ajustesDoPreset(timeline: Timeline, presetId: string): { ajustes: NonNullable<PedidoDeRender["ajustes"]>; timeline: Timeline } {
    const preset = this.d.catalogo.preset(presetId);
    const { largura, altura } = timeline.formato;
    let escala = 1;
    if (preset.largura && preset.altura) {
      if (Math.abs(preset.largura / preset.altura - largura / altura) > 0.01) {
        throw new ErroAplicacao("preset-incompativel", `O preset "${preset.nome}" é ${preset.largura}×${preset.altura} e a timeline é ${largura}×${altura}. Mude o formato da timeline antes de exportar.`);
      }
      escala = preset.largura / largura;
    }
    return {
      ajustes: { escala, crf: preset.crf, velocidadeDeCodificacao: preset.velocidadeDeCodificacao, taxaDeBitsDoAudioKbps: preset.taxaDeBitsDoAudioKbps },
      timeline: preset.fps ? { ...timeline, formato: { ...timeline.formato, fps: preset.fps } } : timeline,
    };
  }

  /** Cancela uma tarefa na fila ou em andamento. Nenhum arquivo parcial fica para trás. */
  cancelar(exportacaoId: number): void {
    const cancelamento = this.emAndamento.get(exportacaoId);
    if (cancelamento) {
      cancelamento.cancelado = true;
      cancelamento.interromper?.();
    } else if (this.d.timelines.exportacao(exportacaoId).estado === "na-fila") {
      this.d.timelines.atualizarExportacao(exportacaoId, { estado: "cancelada", concluidoEm: agora() });
    }
  }

  /** Cancela tudo o que estiver em andamento (usado ao encerrar a aplicação) e espera a fila esvaziar. */
  async cancelarTudo(): Promise<void> {
    for (const id of this.emAndamento.keys()) this.cancelar(id);
    await this.fila;
  }

  /** Histórico de exportações do projeto, da mais recente para a mais antiga. */
  exportacoes(projetoId: string): Exportacao[] {
    return this.d.timelines.exportacoes(projetoId);
  }

  /** Repete uma exportação (com a mesma versão da timeline e o mesmo preset). O arquivo anterior é mantido. */
  repetir(exportacaoId: number): TarefaDeRender {
    const anterior = this.d.timelines.exportacao(exportacaoId);
    return this.renderizar(anterior.projetoId, anterior.tipo, { versao: anterior.versaoDaTimeline, preset: anterior.preset ?? undefined });
  }

  /**
   * Na abertura: fecha as exportações que ficaram pela metade e apaga os arquivos temporários
   * de render. Só é apagado o que pertence a processos que já terminaram: um render em
   * andamento em outro processo não é tocado.
   */
  recuperar(): number {
    for (const nome of existsSync(this.d.caminhos.temporarios) ? readdirSync(this.d.caminhos.temporarios) : []) {
      if (/^render-\d+\.mp4$/.test(nome)) rmSync(path.join(this.d.caminhos.temporarios, nome), { force: true });
    }
    const publica = path.join(this.d.caminhos.temporarios, "remotion-pacote", "public");
    for (const nome of existsSync(publica) ? readdirSync(publica) : []) {
      const pid = Number(/-(\d+)$/.exec(nome)?.[1] ?? NaN);
      if (!Number.isInteger(pid) || pid === process.pid || !processoVivo(pid)) rmSync(path.join(publica, nome), { recursive: true, force: true });
    }
    return this.d.timelines.recuperarInterrompidas();
  }

  /** Caminho que ainda não existe: nunca sobrescreve um arquivo anterior. */
  private semSobrescrever(caminho: string): string {
    const { dir, name, ext } = path.parse(caminho);
    let livre = caminho;
    for (let n = 2; existsSync(livre); n += 1) livre = path.join(dir, `${name} (${n})${ext}`);
    return livre;
  }

  /** Nome do arquivo final: projeto, versão da timeline, preset (se houver) e data e hora. */
  private nomeDaExportacao(projetoId: string, versao: number, preset: string | null): { pasta: string; nome: string } {
    const projeto = this.d.projetos.obter(projetoId).nome.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").trim() || "video";
    const carimbo = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
    return { pasta: path.join(this.d.caminhos.exportacoes, projeto), nome: `${projeto} v${versao}${preset && preset !== "padrao" ? ` ${preset}` : ""} ${carimbo}` };
  }

  private async executar(id: number, versao: VersaoDaTimeline, perfilDeQualidade?: string): Promise<Exportacao> {
    const { timelines, eventos, caminhos, hardware, qualidade } = this.d;
    const inicial = timelines.exportacao(id);
    if (inicial.estado === "cancelada") return inicial;
    const tipo = inicial.tipo;
    const cancelamento: Cancelamento = { cancelado: false };
    this.emAndamento.set(id, cancelamento);
    const emitir = (exportacao: Exportacao) => { eventos.emit("render:atualizado", exportacao); return exportacao; };
    const resumir = resumoDoRelatorio;
    emitir(timelines.atualizarExportacao(id, { estado: "renderizando" }));

    try {
      // Antes de renderizar a versão final: o que já dá para conferir na timeline. Falha
      // obrigatória (arquivo ausente, timeline vazia) interrompe aqui, sem gastar tempo de render.
      if (tipo === "final") {
        const previo = await qualidade.verificarTimeline(versao.projetoId, { versao: versao.versao, perfil: perfilDeQualidade });
        if (previo.situacao === "reprovado") {
          const obrigatorias = previo.verificacoes.filter((v) => v.situacao === "reprovada" && v.gravidade === "obrigatoria").map((v) => v.detalhe);
          return emitir(timelines.atualizarExportacao(id, {
            estado: "falhou", verificacao: resumir(previo), erro: `A exportação não foi iniciada: ${obrigatorias.join(" ")}`.slice(0, 500), concluidoEm: agora(),
          }));
        }
      }

      const doPreset = inicial.preset ? this.ajustesDoPreset(versao.timeline, inicial.preset) : null;
      const timeline = doPreset?.timeline ?? versao.timeline;
      // Paralelismo limitado pelos núcleos e pela memória livre (cada quadro em paralelo abre uma aba do navegador).
      const porMemoria = Math.floor(os.freemem() / 1024 / 1024 / 1500);
      const concorrencia = Math.max(1, Math.min(Math.floor(hardware.nucleos / 2), porMemoria, 8));
      // A prévia vai direto para a pasta de prévias; a versão final fica em uma área de espera até ser conferida.
      const saida = tipo === "previa"
        ? path.join(caminhos.projetos, versao.projetoId, "previas", `previa-v${versao.versao}.mp4`)
        : path.join(caminhos.projetos, versao.projetoId, "em-conferencia", `exportacao-${id}.mp4`);
      let gravado = 0;
      const aoProgredir = (fase: "preparando" | "renderizando", fracao: number) => {
        const progresso = Math.round((fase === "preparando" ? 0.15 * fracao : 0.15 + 0.75 * fracao) * 1000) / 1000;
        eventos.emit("render:progresso", { id, projetoId: versao.projetoId, fase, progresso });
        if (progresso - gravado >= 0.05) { gravado = progresso; timelines.atualizarExportacao(id, { progresso }); }
      };

      let tamanho: { largura: number; altura: number } | null = null;
      let ultimoErro = "";
      // Primeira tentativa com os recursos do computador; se falhar, uma segunda em modo conservador
      // (um quadro por vez, codificação pela CPU), que resolve falta de memória e falhas de GPU.
      for (const tentativa of [1, 2]) {
        timelines.atualizarExportacao(id, { tentativas: tentativa });
        try {
          tamanho = await renderizarTimeline({
            id: String(id), timeline, destino: saida, qualidade: tipo, ajustes: tipo === "final" ? doPreset?.ajustes : undefined,
            pastaDeCache: path.join(caminhos.projetos, versao.projetoId, "cache"), pastaTemporaria: caminhos.temporarios,
            concorrencia: tentativa === 1 ? concorrencia : 1, codificarPorHardware: tentativa === 1 && hardware.codificacaoPorHardware,
            cancelamento, aoProgredir,
          });
          break;
        } catch (erro) {
          if (erro instanceof RenderCancelado) throw erro;
          ultimoErro = erro instanceof Error ? erro.message : String(erro);
          if (process.env.IAEV_DEPURAR) console.error(`[render ${id}] tentativa ${tentativa} falhou: ${ultimoErro}`);
        }
      }
      if (!tamanho) return emitir(timelines.atualizarExportacao(id, { estado: "falhou", erro: ultimoErro.slice(0, 500), concluidoEm: agora() }));

      if (tipo === "previa") {
        // Prévia: conferência básica do arquivo (abre, tem o formato esperado e a duração certa).
        const exame = await new AgenteDeArquivos().examinar(saida);
        const t = exame.tecnico;
        const problemas = [
          exame.integridade !== "integro" ? `arquivo ${exame.integridade}` : "",
          t && (t.largura !== tamanho.largura || t.altura !== tamanho.altura) ? `resolução ${t.largura}×${t.altura}, esperada ${tamanho.largura}×${tamanho.altura}` : "",
          t && Math.abs(t.duracaoSeg - timeline.duracaoSeg) > 0.25 ? `duração de ${t.duracaoSeg.toFixed(2)} s, esperada ${timeline.duracaoSeg.toFixed(2)} s` : "",
        ].filter(Boolean);
        return emitir(timelines.atualizarExportacao(id, {
          estado: problemas.length ? "falhou" : "concluida", progresso: 1, arquivo: saida, largura: t?.largura ?? null, altura: t?.altura ?? null, fps: t?.fps ?? null,
          duracaoSeg: t?.duracaoSeg ?? null, tamanhoBytes: statSync(saida).size, verificacao: { aprovada: problemas.length === 0, problemas },
          erro: problemas.length ? `A prévia não passou na conferência: ${problemas.join("; ")}` : null, concluidoEm: agora(),
        }));
      }

      // Versão final: controle de qualidade completo sobre o arquivo, com ferramentas independentes do renderizador.
      eventos.emit("render:progresso", { id, projetoId: versao.projetoId, fase: "conferindo", progresso: 0.92 });
      const relatorio = await qualidade.verificarExportacao(
        timelines.exportacao(id), saida, { ...versao, timeline }, { ...tamanho, fps: timeline.formato.fps }, perfilDeQualidade,
      );
      const { pasta, nome } = this.nomeDaExportacao(versao.projetoId, versao.versao, inicial.preset);
      const reprovado = relatorio.situacao === "reprovado";
      // Um vídeo reprovado não entra em Exportações/: fica guardado à parte, para análise.
      const arquivo = this.semSobrescrever(reprovado ? path.join(caminhos.projetos, versao.projetoId, "reprovados", `${nome}.mp4`) : path.join(pasta, `${nome}.mp4`));
      const tamanhoBytes = statSync(saida).size;
      moverArquivo(saida, arquivo);
      qualidade.definirArquivo(relatorio.id, arquivo);
      qualidade.gravarMarkdown(relatorio.id);

      const exame = await new AgenteDeArquivos().examinar(arquivo);
      const resumo = resumir(relatorio);
      return emitir(timelines.atualizarExportacao(id, {
        estado: reprovado ? "falhou" : "concluida", progresso: 1, arquivo, largura: exame.tecnico?.largura ?? null, altura: exame.tecnico?.altura ?? null,
        fps: exame.tecnico?.fps ?? null, duracaoSeg: exame.tecnico?.duracaoSeg ?? null, tamanhoBytes, verificacao: resumo,
        erro: reprovado ? `Reprovado no controle de qualidade: ${resumo.problemas.filter((x) => x.includes("(obrigatoria)")).join(" ")}`.slice(0, 500) : null, concluidoEm: agora(),
      }));
    } catch (erro) {
      const estado = erro instanceof RenderCancelado ? "cancelada" : "falhou";
      try {
        return emitir(timelines.atualizarExportacao(id, { estado, erro: estado === "falhou" ? String(erro instanceof Error ? erro.message : erro).slice(0, 500) : null, concluidoEm: agora() }));
      } catch {
        // O banco já foi fechado (aplicação encerrando): o registro é acertado na próxima abertura.
        return { ...inicial, estado };
      }
    } finally {
      this.emAndamento.delete(id);
      rmSync(path.join(caminhos.projetos, versao.projetoId, "em-conferencia", `exportacao-${id}.mp4`), { force: true });
    }
  }
}

