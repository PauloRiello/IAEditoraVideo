// Agente Coordenador: conduz a preparação de um vídeo — importar os brutos, examinar os
// arquivos, analisar o conteúdo, indexar, planejar, receber a revisão do usuário e escrever
// o roteiro — acionando os agentes especializados e guardando tudo na memória persistente.

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { AgenteDeConteudo } from "../../Pipeline/analysis/conteudo.ts";
import { AgenteDePlanejamento, type Material } from "../../Pipeline/editing/planejamento.ts";
import { AgenteDeRoteiro } from "../../Pipeline/editing/roteiro.ts";
import { AgenteDeArquivos, EXTENSOES_DE_VIDEO } from "../../Pipeline/ingestion/arquivos.ts";
import { ErroAplicacao, NaoEncontrado } from "../dominio/erros.ts";
import type { Observacao, VersaoPlano } from "../dominio/memoria.ts";
import type { Agente, AnaliseDeConteudo, ArquivoBruto, Briefing, EntradaDoIndice, PlanoDeEdicao, ResultadoDaPesquisa, Roteiro } from "../dominio/producao.ts";
import type { FormatoSaida, Midia, Projeto } from "../dominio/tipos.ts";
import type { ServicoAprendizado } from "../servicos/aprendizado.ts";
import type { ServicoEstilos } from "../servicos/estilos.ts";
import type { ServicoIndice } from "../servicos/indice.ts";
import type { ServicoMemoria } from "../servicos/memoria.ts";
import type { ServicoPerfis } from "../servicos/perfis.ts";
import type { ServicoProjetos } from "../servicos/projetos.ts";
import type { RegistroProvedores } from "../servicos/provedores.ts";
import { criarTranscritor, type DependenciasDoTranscritor } from "./transcricao.ts";

export interface DependenciasDaProducao extends DependenciasDoTranscritor {
  projetos: ServicoProjetos;
  aprendizado: ServicoAprendizado;
  memoria: ServicoMemoria;
  perfis: ServicoPerfis;
  indice: ServicoIndice;
  estilos: ServicoEstilos;
  provedores: Pick<RegistroProvedores, "selecionar">;
}

export interface BrutoAnalisado {
  midia: Midia;
  arquivo: ArquivoBruto;
  /** Ausente quando o arquivo não pôde ser lido. */
  conteudo: AnaliseDeConteudo | null;
}

/** Correção feita pelo usuário ao revisar um plano; alimenta o aprendizado do projeto. */
export type CorrecaoDoPlano = Pick<Observacao, "categoria" | "chave" | "descricao" | "valor" | "contexto">;

export class Producao implements Agente {
  id = "coordenador";
  nome = "Agente Coordenador";
  responsabilidade = "Conduzir a preparação do vídeo e integrar os agentes especializados à memória.";
  agentes = { arquivos: new AgenteDeArquivos(), conteudo: new AgenteDeConteudo(), planejamento: new AgenteDePlanejamento(), roteiro: new AgenteDeRoteiro() };
  private d: DependenciasDaProducao;

  constructor(dependencias: DependenciasDaProducao) {
    this.d = dependencias;
  }

  /** Os cinco agentes e o que cada um faz. */
  listarAgentes(): Agente[] {
    return [this, ...Object.values(this.agentes)].map(({ id, nome, responsabilidade }) => ({ id, nome, responsabilidade }));
  }

  // --- Importação e análise ---------------------------------------------------------

  /**
   * Registra no projeto os vídeos novos de Videos Brutos/. Se existir uma subpasta com o
   * nome do projeto, só ela é usada; senão, a pasta inteira. Os arquivos não são copiados.
   */
  importarBrutos(projetoId: string): Midia[] {
    const projeto = this.d.projetos.obter(projetoId);
    const propria = path.join(this.d.caminhos.brutos, projeto.configuracao.pasta || projeto.nome);
    const raiz = existsSync(propria) ? propria : this.d.caminhos.brutos;
    const conhecidos = new Set(this.d.projetos.midias(projetoId, "bruto").map((m) => m.caminho));
    const novas: Midia[] = [];
    const percorrer = (pasta: string) => {
      for (const item of readdirSync(pasta, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const caminho = path.join(pasta, item.name);
        if (item.isDirectory()) percorrer(caminho);
        else if (EXTENSOES_DE_VIDEO.has(path.extname(item.name).toLowerCase()) && !conhecidos.has(caminho)) novas.push(this.d.projetos.registrarMidia(projetoId, "bruto", caminho));
      }
    };
    if (existsSync(raiz)) percorrer(raiz);
    return novas;
  }

  /** Examina, analisa e indexa os vídeos brutos do projeto. Arquivos já analisados são reaproveitados, salvo `refazer`. */
  async analisarBrutos(
    projetoId: string,
    opcoes: { refazer?: boolean; transcrever?: boolean; aoAvancar?: (arquivo: string, feitos: number, total: number) => void } = {},
  ): Promise<BrutoAnalisado[]> {
    const projeto = this.d.projetos.obter(projetoId);
    const formato = this.formatoDoProjeto(projeto);
    const transcrever = opcoes.transcrever === false ? undefined : criarTranscritor(this.d, "analise-de-bruto", projetoId);
    const resultados: BrutoAnalisado[] = [];
    const midias = this.d.projetos.midias(projetoId, "bruto");

    for (const [posicao, midia] of midias.entries()) {
      opcoes.aoAvancar?.(midia.caminho, posicao, midias.length);
      const anterior = opcoes.refazer ? null : this.analisado(midia);
      if (anterior) { resultados.push(anterior); continue; }

      const arquivo = await this.agentes.arquivos.examinar(midia.caminho, formato);
      this.d.acervo.registrarAnalise({ midiaId: midia.id }, "arquivo", arquivo);
      let conteudo: AnaliseDeConteudo | null = null;
      if (arquivo.tecnico) {
        conteudo = await this.agentes.conteudo.analisar(midia.id, arquivo, {
          pastaDeMiniaturas: path.join(this.d.caminhos.projetos, projetoId, "miniaturas", midia.id),
          transcrever,
          provedores: this.d.provedores,
        });
        this.d.acervo.registrarAnalise({ midiaId: midia.id }, "conteudo", conteudo);
      }
      this.d.indice.gravar(midia.id, projetoId, this.agentes.conteudo.indexar(arquivo, conteudo));
      resultados.push({ midia, arquivo, conteudo });
    }
    return resultados;
  }

  /**
   * Formato de saída do projeto: o do perfil, com a resolução e a taxa de quadros que o
   * usuário tiver escolhido na configuração do projeto.
   */
  formatoDoProjeto(projeto: Projeto): FormatoSaida {
    const base = this.d.perfis.formato(projeto.perfil, projeto.formato);
    const { largura, altura, fps } = projeto.configuracao;
    if (largura === null || altura === null) return { ...base, fps: fps ?? base.fps };
    const proporcao = largura === altura ? "Quadrado" : altura > largura ? "Vertical" : "Horizontal";
    // O limite de duração do formato do perfil só vale se a orientação escolhida for a mesma.
    const mesmaOrientacao = Math.sign(base.altura - base.largura) === Math.sign(altura - largura);
    return {
      id: `${largura}x${altura}`, nome: `${proporcao} ${largura}×${altura}`, largura, altura, fps: fps ?? base.fps,
      ...(mesmaOrientacao && base.duracaoMaximaSeg ? { duracaoMaximaSeg: base.duracaoMaximaSeg } : {}),
    };
  }

  /** Última análise gravada de uma mídia, se houver. */
  analisado(midia: Midia): BrutoAnalisado | null {
    const arquivo = this.d.acervo.analises({ midiaId: midia.id }, "arquivo")[0]?.resultado as ArquivoBruto | undefined;
    if (!arquivo) return null;
    const conteudo = (this.d.acervo.analises({ midiaId: midia.id }, "conteudo")[0]?.resultado as AnaliseDeConteudo | undefined) ?? null;
    return { midia, arquivo, conteudo };
  }

  /** Pesquisa os vídeos brutos por palavras ditas, assuntos, acontecimentos ou características. */
  pesquisar(consulta: string, filtros: { projetoId?: string; tipo?: EntradaDoIndice["tipo"]; limite?: number } = {}): ResultadoDaPesquisa[] {
    return this.d.indice.pesquisar(consulta, filtros);
  }

  // --- Planejamento e aprovação -------------------------------------------------------

  /** Gera um plano de edição a partir do briefing e o salva como nova versão, em rascunho. */
  planejar(projetoId: string, briefing: Briefing): VersaoPlano {
    const projeto = this.d.projetos.obter(projetoId);
    const materiais: Material[] = this.d.projetos
      .midias(projetoId, "bruto")
      .map((midia) => this.analisado(midia))
      .filter((b): b is BrutoAnalisado & { conteudo: AnaliseDeConteudo } => b !== null && b.conteudo !== null)
      .map((b) => ({ midiaId: b.midia.id, arquivo: b.arquivo, conteudo: b.conteudo }));
    if (materiais.length === 0) throw new ErroAplicacao("sem-material", "Não há vídeos brutos analisados neste projeto. Importe e analise os vídeos antes de planejar.");

    const plano = this.agentes.planejamento.planejar({
      perfil: this.d.perfis.obter(projeto.perfil),
      formato: this.formatoDoProjeto(projeto),
      briefing,
      materiais,
      aprendizados: this.d.aprendizado.consultar({ projetoId, perfis: [projeto.perfil] }).aplicaveis,
      estilosDeReferencia: this.d.acervo
        .referencias(projetoId)
        .map((r) => this.d.acervo.analises({ referenciaId: r.id }, "perfil-de-estilo")[0]?.resultado as Record<string, string> | undefined)
        .filter((estilo): estilo is Record<string, string> => Boolean(estilo)),
      duracaoDoPlanoDoEstilo: briefing.estilos?.length ? this.d.estilos.combinar(briefing.estilos).estilo.duracaoDoPlanoSeg : undefined,
    });
    this.d.memoria.lembrar(`projeto:${projetoId}`, "briefing", briefing);
    const versao = this.d.acervo.salvarPlano(projetoId, plano, "ia", `Plano gerado para: ${briefing.objetivo}`);
    this.d.acervo.registrarDecisao(projetoId, "plano-gerado", `${plano.clipes.length} trecho(s), ${plano.duracaoPlanejadaSeg} s. Objetivo: ${briefing.objetivo}`, versao.versao);
    return versao;
  }

  briefing(projetoId: string): Briefing | undefined {
    return this.d.memoria.recordar<Briefing>(`projeto:${projetoId}`, "briefing");
  }

  /**
   * Grava a versão do plano alterada pelo usuário. A alteração fica no histórico, e cada
   * correção informada vale para o projeto e entra como candidata no perfil dele.
   */
  revisarPlano(projetoId: string, plano: PlanoDeEdicao, nota: string, correcoes: CorrecaoDoPlano[] = []): VersaoPlano {
    const versao = this.d.acervo.salvarPlano(projetoId, plano, "usuario", nota);
    this.d.acervo.registrarDecisao(projetoId, "alteracao", nota, versao.versao);
    for (const correcao of correcoes) this.d.aprendizado.registrarCorrecao(projetoId, { ...correcao, detalhe: `Revisão do plano v${versao.versao}: ${nota}` });
    return versao;
  }

  /** Aprova a versão mais recente do plano. Os aprendizados que ele aplicou ganham uma confirmação. */
  aprovarPlano(projetoId: string): VersaoPlano {
    const atual = this.d.acervo.plano(projetoId);
    const aprovado = this.d.acervo.decidirPlano(projetoId, atual.versao, "aprovado");
    this.d.acervo.registrarDecisao(projetoId, "aprovacao", `Plano v${atual.versao} aprovado.`, atual.versao);
    for (const decisao of (atual.plano as PlanoDeEdicao).decisoes ?? []) {
      if (decisao.aprendizadoId === undefined) continue;
      try {
        this.d.aprendizado.confirmar(decisao.aprendizadoId, { origem: "feedback", projetoObservado: projetoId, detalhe: `Plano v${atual.versao} aprovado` });
      } catch (erro) {
        if (!(erro instanceof NaoEncontrado)) throw erro; // o aprendizado foi excluído depois de o plano ser gerado
      }
    }
    return aprovado;
  }

  rejeitarPlano(projetoId: string, motivo: string): VersaoPlano {
    const atual = this.d.acervo.plano(projetoId);
    this.d.acervo.registrarDecisao(projetoId, "rejeicao", `Plano v${atual.versao} rejeitado: ${motivo}`, atual.versao);
    return this.d.acervo.decidirPlano(projetoId, atual.versao, "rejeitado");
  }

  /** Plano aprovado, exigido antes de qualquer edição. Lança erro se a versão atual não estiver aprovada. */
  exigirPlanoAprovado(projetoId: string): VersaoPlano {
    const aprovado = this.d.acervo.planoAprovado(projetoId);
    if (!aprovado) throw new ErroAplicacao("plano-nao-aprovado", "A edição só começa depois que o plano atual for aprovado.");
    return aprovado;
  }

  // --- Roteiro ------------------------------------------------------------------------

  /** Escreve o roteiro da versão atual do plano e o guarda na memória do projeto. */
  async escreverRoteiro(projetoId: string): Promise<Roteiro> {
    const projeto = this.d.projetos.obter(projetoId);
    const versao = this.d.acervo.plano(projetoId);
    const roteiro = await this.agentes.roteiro.escrever({
      projetoId,
      perfil: this.d.perfis.obter(projeto.perfil),
      briefing: this.briefing(projetoId) ?? { objetivo: (versao.plano as PlanoDeEdicao).objetivo },
      plano: versao.plano as PlanoDeEdicao,
      provedores: this.d.provedores,
    });
    this.d.memoria.lembrar(`projeto:${projetoId}`, "roteiro", roteiro);
    this.d.acervo.registrarDecisao(projetoId, "roteiro", `Roteiro (${roteiro.base}) com ${roteiro.linhas.length} linha(s) para o plano v${versao.versao}.`, versao.versao);
    return roteiro;
  }

  roteiro(projetoId: string): Roteiro | undefined {
    return this.d.memoria.recordar<Roteiro>(`projeto:${projetoId}`, "roteiro");
  }
}
