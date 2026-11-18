// Fluxo de trabalho de um projeto: as ações que a interface aciona, na ordem em que o
// usuário as percorre. Aqui ficam a configuração do projeto, o nível de intervenção
// automática, as tarefas em segundo plano e o histórico de atividades. A edição continua
// esperando a aprovação do plano, e a exportação final é sempre pedida pelo usuário.

import type { ServicoMarcas } from "../servicos/marcas.ts";
import type { EventEmitter } from "node:events";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { ErroAplicacao } from "../dominio/erros.ts";
import type { VersaoPlano } from "../dominio/memoria.ts";
import type { Briefing, PlanoDeEdicao } from "../dominio/producao.ts";
import type { Exportacao, VersaoDaTimeline } from "../dominio/timeline.ts";
import type { Atividade, ConfiguracaoDoProjeto, Projeto } from "../dominio/tipos.ts";
import type { Caminhos } from "../infra/caminhos.ts";
import type { ServicoAcervo } from "../servicos/acervo.ts";
import type { ServicoAtividades } from "../servicos/atividades.ts";
import type { ServicoPerfis } from "../servicos/perfis.ts";
import type { ServicoProjetos } from "../servicos/projetos.ts";
import type { Edicao, OpcoesDeExportacao, TarefaDeRender } from "./edicao.ts";
import type { Feedback, PedidoDeAvaliacao } from "./feedback.ts";
import type { Producao } from "./producao.ts";
import type { AnaliseDeReferencias } from "./referencias.ts";
import type { TarefaIniciada, Tarefas } from "./tarefas.ts";

export interface DependenciasDoFluxo {
  caminhos: Caminhos;
  eventos: EventEmitter;
  projetos: ServicoProjetos;
  perfis: ServicoPerfis;
  acervo: ServicoAcervo;
  atividades: ServicoAtividades;
  tarefas: Tarefas;
  producao: Producao;
  edicao: Edicao;
  referencias: AnaliseDeReferencias;
  feedback: Feedback;
  marcas: ServicoMarcas;
}

/** Tipos de arquivo aceitos como vídeo (bruto ou referência) e como trilha sonora. */
export { EXTENSOES_DE_VIDEO } from "../../Pipeline/ingestion/arquivos.ts";
export const EXTENSOES_DE_AUDIO = new Set([".mp3", ".m4a", ".wav", ".ogg", ".flac", ".aac"]);

/** Nome de pasta aceito pelo Windows, a partir de um texto livre. */
export const nomeDePasta = (texto: string): string => texto.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").replace(/[. ]+$/, "").trim().slice(0, 80) || "Projeto";

export class Fluxo {
  private d: DependenciasDoFluxo;

  constructor(dependencias: DependenciasDoFluxo) {
    this.d = dependencias;
  }

  /** Registra uma atividade no histórico e avisa a interface. */
  registrar(tipo: string, descricao: string, projetoId: string | null = null): Atividade {
    const atividade = this.d.atividades.registrar(tipo, descricao, projetoId);
    if (projetoId) this.d.projetos.tocar(projetoId);
    this.d.eventos.emit("atividade", atividade);
    return atividade;
  }

  // --- Projeto ----------------------------------------------------------------------------

  /** Cria o projeto com a configuração informada e a pasta dele em Videos Brutos/. */
  criarProjeto(dados: { nome: string; perfil: string; configuracao?: Partial<ConfiguracaoDoProjeto> }): Projeto {
    const perfil = this.d.perfis.obter(dados.perfil);
    this.conferirMarca(dados.configuracao?.marca);
    const pasta = nomeDePasta(dados.nome);
    const emUso = new Set(this.d.projetos.listar().map((p) => p.configuracao.pasta.toLowerCase()));
    let livre = pasta;
    for (let n = 2; emUso.has(livre.toLowerCase()); n += 1) livre = `${pasta} (${n})`;
    const projeto = this.d.projetos.criar({ nome: dados.nome, perfil: perfil.id, formato: this.d.perfis.formato(perfil.id).id, configuracao: { ...dados.configuracao, pasta: livre } });
    mkdirSync(this.pastaDeBrutos(projeto), { recursive: true });
    this.registrar("projeto", `Projeto "${projeto.nome}" criado no perfil ${perfil.nome}.`, projeto.id);
    return projeto;
  }

  /** Altera nome, perfil ou configuração. A pasta de material do projeto não muda de nome. */
  configurar(projetoId: string, dados: { nome?: string; perfil?: string; configuracao?: Partial<ConfiguracaoDoProjeto> }): Projeto {
    const atual = this.d.projetos.obter(projetoId);
    const perfil = this.d.perfis.obter(dados.perfil ?? atual.perfil);
    const formato = perfil.formatos.some((f) => f.id === atual.formato) ? atual.formato : perfil.formatoPadrao;
    const { pasta: _pasta, ...configuracao } = dados.configuracao ?? {};
    if (configuracao.marca !== undefined && configuracao.marca !== atual.configuracao.marca) this.conferirMarca(configuracao.marca);
    const projeto = this.d.projetos.atualizar(projetoId, { nome: dados.nome, perfil: perfil.id, formato, configuracao });
    this.registrar("projeto", "Configuração do projeto alterada.", projetoId);
    return projeto;
  }

  /** Um projeto só escolhe marca pronta (logo e cores confirmados). */
  private conferirMarca(id: string | undefined): void {
    if (!id) return;
    const marca = this.d.marcas.obter(id);
    if (marca.estado !== "pronta") throw new ErroAplicacao("marca-nao-pronta", `A marca "${marca.nome}" ainda não está pronta: confirme o logo e as cores na tela de marcas.`);
  }

  /** Pasta de Videos Brutos/ com o material do projeto. */
  pastaDeBrutos(projeto: Projeto): string {
    return path.join(this.d.caminhos.brutos, projeto.configuracao.pasta || projeto.nome);
  }

  /** Briefing do plano, montado só com o que o usuário informou na configuração do projeto. */
  briefing(projeto: Projeto): Briefing {
    const c = projeto.configuracao;
    if (!c.objetivo) throw new ErroAplicacao("objetivo-obrigatorio", "Informe o objetivo do vídeo na configuração do projeto antes de gerar o plano.");
    return {
      objetivo: c.objetivo, ...(c.publico ? { publico: c.publico } : {}), ...(c.plataforma ? { plataforma: c.plataforma } : {}), ...(c.cta ? { cta: c.cta } : {}),
      ...(c.duracaoSeg ? { duracaoDesejadaSeg: c.duracaoSeg } : {}), fatos: c.fatos, estilos: c.estilos,
    };
  }

  // --- Material e análise -------------------------------------------------------------------

  /** Registra no projeto os vídeos novos da pasta dele. */
  importarBrutos(projetoId: string): number {
    const novas = this.d.producao.importarBrutos(projetoId);
    if (novas.length) this.registrar("material", `${novas.length} vídeo(s) bruto(s) adicionado(s) ao projeto.`, projetoId);
    return novas.length;
  }

  /**
   * Analisa em segundo plano os vídeos brutos do projeto (dados técnicos, cenas, ação e,
   * se pedido, transcrição). Fora do nível "sugestao", gera o primeiro plano ao terminar.
   */
  analisarBrutos(projetoId: string, opcoes: { transcrever?: boolean; refazer?: boolean } = {}): TarefaIniciada {
    const projeto = this.d.projetos.obter(projetoId);
    this.importarBrutos(projetoId);
    return this.d.tarefas.iniciar({ tipo: "analise-de-brutos", titulo: `Análise dos vídeos brutos de ${projeto.nome}`, projetoId }, async (informar) => {
      const analisados = await this.d.producao.analisarBrutos(projetoId, {
        // Os últimos 5% ficam para gravar e, se for o caso, gerar o plano.
        ...opcoes, aoAvancar: (etapa, fracao) => informar(`Analisando ${etapa}`, fracao * 0.95),
      });
      informar("Gravando a análise", 0.95);
      const comProblema = analisados.filter((b) => b.arquivo.integridade !== "integro").length;
      this.registrar("analise", `${analisados.length} vídeo(s) bruto(s) analisado(s)${comProblema ? `, ${comProblema} com problema` : ""}.`, projetoId);
      const atual = this.d.projetos.obter(projetoId);
      if (atual.configuracao.intervencao !== "sugestao" && atual.configuracao.objetivo && analisados.some((b) => b.conteudo) && !this.temPlano(projetoId)) {
        informar("Gerando o plano de edição", 0.97);
        this.planejar(projetoId);
      }
    });
  }

  /** Analisa referências em segundo plano e grava os relatórios. */
  analisarReferencias(referenciaIds: string[], opcoes: { transcrever?: boolean } = {}): TarefaIniciada {
    const referencias = referenciaIds.map((id) => this.d.acervo.referencia(id));
    const titulo = referencias.length === 1 ? `Análise da referência ${referencias[0].titulo}` : `Análise de ${referencias.length} referências`;
    return this.d.tarefas.iniciar({ tipo: "analise-de-referencias", titulo, projetoId: null }, async (informar) => {
      const falhas: string[] = [];
      for (const [posicao, referencia] of referencias.entries()) {
        const avancar = (etapa: string, fracao: number) => informar(`Analisando ${referencia.titulo} (${posicao + 1} de ${referencias.length}): ${etapa}`, (posicao + fracao) / referencias.length);
        avancar("começando", 0);
        try {
          const resultado = await this.d.referencias.analisar(referencia.id, { ...opcoes, aoAvancar: (etapa, fracao) => avancar(etapa, fracao * 0.95) });
          avancar("gravando o relatório", 0.97);
          this.registrar("analise", `Referência "${referencia.titulo}" analisada: ${resultado.relatorio.regras.length} regra(s) de edição identificada(s).`);
        } catch (erro) {
          falhas.push(`${referencia.titulo}: ${erro instanceof Error ? erro.message : String(erro)}`);
        }
      }
      if (falhas.length) throw new ErroAplicacao("analise-incompleta", `Não foi possível analisar: ${falhas.join("; ")}`);
    });
  }

  // --- Plano, roteiro e timeline --------------------------------------------------------------

  private temPlano(projetoId: string): boolean {
    return this.d.acervo.historicoDePlanos(projetoId).length > 0;
  }

  /** Gera uma nova versão do plano a partir da configuração do projeto. */
  planejar(projetoId: string): VersaoPlano {
    const versao = this.d.producao.planejar(projetoId, this.briefing(this.d.projetos.obter(projetoId)));
    const plano = versao.plano as PlanoDeEdicao;
    this.registrar("plano", `Plano v${versao.versao} gerado: ${plano.clipes.length} trecho(s), ${plano.duracaoPlanejadaSeg} s.`, projetoId);
    return versao;
  }

  /**
   * Aprova o plano atual. Fora do nível "sugestao", a timeline é montada em seguida; no
   * nível "automatico", a prévia também é gerada.
   */
  aprovarPlano(projetoId: string): { plano: VersaoPlano; timeline: VersaoDaTimeline | null; previa: Exportacao | null; avisos: string[] } {
    const plano = this.d.producao.aprovarPlano(projetoId);
    this.registrar("plano", `Plano v${plano.versao} aprovado.`, projetoId);
    if (this.d.projetos.obter(projetoId).configuracao.intervencao === "sugestao") return { plano, timeline: null, previa: null, avisos: [] };
    const montada = this.montar(projetoId);
    return { plano, timeline: montada.timeline, previa: montada.previa, avisos: montada.avisos };
  }

  rejeitarPlano(projetoId: string, motivo: string): VersaoPlano {
    const plano = this.d.producao.rejeitarPlano(projetoId, motivo);
    this.registrar("plano", `Plano v${plano.versao} rejeitado${motivo ? `: ${motivo}` : "."}`, projetoId);
    return plano;
  }

  async escreverRoteiro(projetoId: string) {
    const roteiro = await this.d.producao.escreverRoteiro(projetoId);
    this.registrar("plano", `Roteiro escrito: ${roteiro.linhas.length} linha(s).`, projetoId);
    return roteiro;
  }

  /** Monta a timeline do plano aprovado nos estilos do projeto. No nível "automatico", gera a prévia. */
  montar(projetoId: string, estilos?: string[]): { timeline: VersaoDaTimeline; previa: Exportacao | null; avisos: string[]; decisoes: unknown[] } {
    const projeto = this.d.projetos.obter(projetoId);
    const montada = this.d.edicao.montar(projetoId, { estilos: estilos ?? projeto.configuracao.estilos });
    this.registrar("edicao", `Timeline v${montada.versao} montada: ${montada.timeline.itens.length} item(ns), ${montada.timeline.duracaoSeg} s.`, projetoId);
    const previa = projeto.configuracao.intervencao === "automatico" ? this.previa(projetoId).exportacao : null;
    const { decisoes, avisos, ...timeline } = montada;
    return { timeline, previa, avisos, decisoes };
  }

  // --- Render -----------------------------------------------------------------------------------

  private acompanhar(tarefa: TarefaDeRender, nome: string): TarefaDeRender {
    const projetoId = tarefa.exportacao.projetoId;
    void tarefa.conclusao.then((e) => {
      const fim = e.estado === "concluida" ? `concluída${e.arquivo && e.tipo === "final" ? `: ${path.basename(e.arquivo)}` : ""}` : e.estado === "cancelada" ? "cancelada" : `falhou: ${e.erro ?? "erro desconhecido"}`;
      try {
        this.registrar("render", `${nome} da timeline v${e.versaoDaTimeline} ${fim}`, projetoId);
      } catch {
        // a aplicação foi encerrada antes de o render terminar
      }
    });
    return tarefa;
  }

  previa(projetoId: string, versao?: number): TarefaDeRender {
    return this.acompanhar(this.d.edicao.previa(projetoId, versao), "Prévia");
  }

  exportar(projetoId: string, opcoes: OpcoesDeExportacao = {}): TarefaDeRender {
    return this.acompanhar(this.d.edicao.exportar(projetoId, opcoes), "Exportação");
  }

  repetir(exportacaoId: number): TarefaDeRender {
    return this.acompanhar(this.d.edicao.repetir(exportacaoId), "Exportação");
  }

  // --- Avaliação ------------------------------------------------------------------------------------

  avaliar(projetoId: string, pedido: PedidoDeAvaliacao) {
    const avaliacao = this.d.feedback.avaliar(projetoId, pedido);
    const decisoes = { aprovada: "aprovada", rejeitada: "rejeitada", "alteracoes-solicitadas": "com alterações solicitadas" } as const;
    this.registrar("avaliacao", `Edição ${decisoes[pedido.decisao]}${pedido.motivo ? `: ${pedido.motivo}` : "."}`, projetoId);
    return avaliacao;
  }

  /** Pasta existe? Usado para oferecer "abrir pasta" só quando há o que abrir. */
  existe(pasta: string): boolean {
    return existsSync(pasta);
  }
}
