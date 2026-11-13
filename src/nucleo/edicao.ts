// Edição e renderização: monta a timeline do plano aprovado, aplica as alterações do
// usuário guardando cada versão, e gerencia as tarefas de render (fila, progresso,
// cancelamento, nova tentativa e histórico de exportações).

import type { EventEmitter } from "node:events";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgenteDeEdicao } from "../../Pipeline/editing/montagem.ts";
import type { Material } from "../../Pipeline/editing/planejamento.ts";
import { AgenteDeArquivos } from "../../Pipeline/ingestion/arquivos.ts";
import { RenderCancelado, renderizarTimeline, type Cancelamento } from "../../Pipeline/rendering/motor.ts";
import { ErroAplicacao } from "../dominio/erros.ts";
import type { AnaliseDeConteudo, ArquivoBruto, Decisao, PlanoDeEdicao, Roteiro } from "../dominio/producao.ts";
import type { Exportacao, ItemAudio, Operacao, VersaoDaTimeline } from "../dominio/timeline.ts";
import { agora } from "../infra/banco.ts";
import type { Caminhos } from "../infra/caminhos.ts";
import type { ServicoAcervo } from "../servicos/acervo.ts";
import type { ServicoAprendizado } from "../servicos/aprendizado.ts";
import type { ServicoEstilos } from "../servicos/estilos.ts";
import type { ServicoMemoria } from "../servicos/memoria.ts";
import type { ServicoProjetos } from "../servicos/projetos.ts";
import type { Hardware } from "../servicos/recursos.ts";
import { aplicarOperacao, descreverOperacao, normalizarTimeline, type ServicoTimeline } from "../servicos/timeline.ts";
import type { Producao } from "./producao.ts";

export interface DependenciasDaEdicao {
  caminhos: Caminhos;
  projetos: ServicoProjetos;
  acervo: ServicoAcervo;
  aprendizado: ServicoAprendizado;
  memoria: ServicoMemoria;
  estilos: ServicoEstilos;
  timelines: ServicoTimeline;
  producao: Producao;
  hardware: Hardware;
  eventos: EventEmitter;
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
    const versao = this.d.timelines.salvar(projetoId, normalizarTimeline(montagem.timeline), "ia", `Montada do plano v${plano.versao} no estilo ${estilo.nome}`);
    this.d.memoria.lembrar(`projeto:${projetoId}`, "montagem", { versao: versao.versao, estilo: estilo.id, decisoes: montagem.decisoes });
    return { ...versao, decisoes: montagem.decisoes, avisos: [...divergencias, ...montagem.avisos] };
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

  /** Prévia de baixa qualidade: um terço da resolução, codificação rápida. */
  previa(projetoId: string, versao?: number): TarefaDeRender {
    return this.renderizar(projetoId, "previa", versao);
  }

  /** Renderização final em MP4 (H.264 + AAC), na pasta Exportações/. */
  exportar(projetoId: string, versao?: number): TarefaDeRender {
    return this.renderizar(projetoId, "final", versao);
  }

  private renderizar(projetoId: string, tipo: "previa" | "final", versao?: number): TarefaDeRender {
    this.d.producao.exigirPlanoAprovado(projetoId);
    const alvo = this.timeline(projetoId, versao);
    const exportacao = this.d.timelines.criarExportacao(projetoId, alvo.versao, tipo);
    // Um render de cada vez: renderizar em paralelo disputaria CPU, memória e GPU.
    const conclusao = this.fila.then(() => this.executar(exportacao.id, alvo));
    this.fila = conclusao.catch(() => undefined);
    return { exportacao, conclusao };
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

  /** Coloca de novo na fila uma exportação que falhou ou foi cancelada. */
  repetir(exportacaoId: number): TarefaDeRender {
    const anterior = this.d.timelines.exportacao(exportacaoId);
    return this.renderizar(anterior.projetoId, anterior.tipo, anterior.versaoDaTimeline);
  }

  /** Na abertura: fecha as exportações que ficaram pela metade e apaga os arquivos temporários de render. */
  recuperar(): number {
    for (const nome of existsSync(this.d.caminhos.temporarios) ? readdirSync(this.d.caminhos.temporarios) : []) {
      if (/^render-\d+\.mp4$/.test(nome)) rmSync(path.join(this.d.caminhos.temporarios, nome), { force: true });
    }
    rmSync(path.join(this.d.caminhos.temporarios, "remotion-pacote", "public"), { recursive: true, force: true });
    return this.d.timelines.recuperarInterrompidas();
  }

  private destino(projetoId: string, versao: number, tipo: "previa" | "final"): string {
    if (tipo === "previa") return path.join(this.d.caminhos.projetos, projetoId, "previas", `previa-v${versao}.mp4`);
    const nome = this.d.projetos.obter(projetoId).nome.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").trim() || "video";
    const carimbo = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
    return path.join(this.d.caminhos.exportacoes, nome, `${nome} v${versao} ${carimbo}.mp4`);
  }

  private async executar(id: number, versao: VersaoDaTimeline): Promise<Exportacao> {
    const { timelines, eventos, caminhos, hardware } = this.d;
    const inicial = timelines.exportacao(id);
    if (inicial.estado === "cancelada") return inicial;
    const tipo = inicial.tipo;
    const cancelamento: Cancelamento = { cancelado: false };
    this.emAndamento.set(id, cancelamento);
    const emitir = (exportacao: Exportacao) => { eventos.emit("render:atualizado", exportacao); return exportacao; };
    emitir(timelines.atualizarExportacao(id, { estado: "renderizando" }));

    // Paralelismo limitado pelos núcleos e pela memória livre (cada quadro em paralelo abre uma aba do navegador).
    const porMemoria = Math.floor(os.freemem() / 1024 / 1024 / 1500);
    const concorrencia = Math.max(1, Math.min(Math.floor(hardware.nucleos / 2), porMemoria, 8));
    const destino = this.destino(versao.projetoId, versao.versao, tipo);
    let gravado = 0;
    const aoProgredir = (fase: "preparando" | "renderizando", fracao: number) => {
      const progresso = Math.round((fase === "preparando" ? 0.15 * fracao : 0.15 + 0.8 * fracao) * 1000) / 1000;
      eventos.emit("render:progresso", { id, projetoId: versao.projetoId, fase, progresso });
      if (progresso - gravado >= 0.05) { gravado = progresso; timelines.atualizarExportacao(id, { progresso }); }
    };

    try {
      let tamanho: { largura: number; altura: number } | null = null;
      let ultimoErro = "";
      // Primeira tentativa com os recursos do computador; se falhar, uma segunda em modo conservador
      // (um quadro por vez, codificação pela CPU), que resolve falta de memória e falhas de GPU.
      for (const tentativa of [1, 2]) {
        timelines.atualizarExportacao(id, { tentativas: tentativa });
        try {
          tamanho = await renderizarTimeline({
            id: String(id), timeline: versao.timeline, destino, qualidade: tipo,
            pastaDeCache: path.join(caminhos.projetos, versao.projetoId, "cache"), pastaTemporaria: caminhos.temporarios,
            concorrencia: tentativa === 1 ? concorrencia : 1, codificarPorHardware: tentativa === 1 && hardware.codificacaoPorHardware,
            cancelamento, aoProgredir,
          });
          break;
        } catch (erro) {
          if (erro instanceof RenderCancelado) throw erro;
          ultimoErro = erro instanceof Error ? erro.message : String(erro);
        }
      }
      if (!tamanho) return emitir(timelines.atualizarExportacao(id, { estado: "falhou", erro: ultimoErro.slice(0, 500), concluidoEm: agora() }));

      // Conferência do arquivo exportado.
      const exame = await new AgenteDeArquivos().examinar(destino);
      const t = exame.tecnico;
      const esperado = versao.timeline;
      const problemas = [
        exame.integridade !== "integro" ? `arquivo ${exame.integridade}` : "",
        t && t.codecVideo !== "h264" ? `vídeo em ${t.codecVideo}, esperado h264` : "",
        t?.codecAudio && t.codecAudio !== "aac" ? `áudio em ${t.codecAudio}, esperado aac` : "",
        t && (t.largura !== tamanho.largura || t.altura !== tamanho.altura) ? `resolução ${t.largura}×${t.altura}, esperada ${tamanho.largura}×${tamanho.altura}` : "",
        t && Math.abs(t.fps - esperado.formato.fps) > 0.01 ? `${t.fps} quadros/s, esperados ${esperado.formato.fps}` : "",
        t && Math.abs(t.duracaoSeg - esperado.duracaoSeg) > 0.25 ? `duração de ${t.duracaoSeg.toFixed(2)} s, esperada ${esperado.duracaoSeg.toFixed(2)} s` : "",
      ].filter(Boolean);
      return emitir(timelines.atualizarExportacao(id, {
        estado: problemas.length ? "falhou" : "concluida", progresso: 1, arquivo: destino, largura: t?.largura ?? null, altura: t?.altura ?? null, fps: t?.fps ?? null,
        duracaoSeg: t?.duracaoSeg ?? null, tamanhoBytes: statSync(destino).size, verificacao: { aprovada: problemas.length === 0, problemas },
        erro: problemas.length ? `O arquivo exportado não passou na conferência: ${problemas.join("; ")}` : null, concluidoEm: agora(),
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
    }
  }
}

