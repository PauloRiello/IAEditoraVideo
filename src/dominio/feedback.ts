// Tipos do feedback do usuário sobre uma edição, da comparação de versões e das
// métricas de resultado informadas depois da publicação.

import type { Aprendizado, CategoriaEdicao } from "./memoria.ts";

/** Aspectos que o usuário pode avaliar, e as categorias de aprendizado ligadas a cada um. */
export const ASPECTOS: Record<string, CategoriaEdicao[]> = {
  roteiro: ["narrativa", "hooks", "cta", "retencao", "comunicacao"],
  ritmo: ["ritmo", "duracao-planos"],
  cortes: ["cortes", "transicoes"],
  efeitos: ["efeitos-visuais", "zoom", "cores", "iluminacao", "movimentos-camera", "enquadramento", "tipografia", "legendas"],
  audio: ["trilha-sonora", "efeitos-sonoros", "sincronizacao-musical"],
  /** Nota do resultado como um todo: não aponta nenhuma categoria específica. */
  resultado: [],
};

export type Aspecto = "roteiro" | "ritmo" | "cortes" | "efeitos" | "audio" | "resultado";
export type DecisaoDaAvaliacao = "aprovada" | "rejeitada" | "alteracoes-solicitadas";

/** Trecho que o usuário marcou para revisão. */
export interface TrechoEmRevisao {
  id: number;
  avaliacaoId: number;
  projetoId: string;
  inicioSeg: number;
  fimSeg: number;
  /** Item da timeline a que o trecho se refere, se houver. */
  itemId: string | null;
  aspecto: Aspecto | null;
  comentario: string;
  resolvido: boolean;
}

export interface Avaliacao {
  id: number;
  projetoId: string;
  versaoDaTimeline: number;
  exportacaoId: number | null;
  decisao: DecisaoDaAvaliacao;
  motivo: string;
  /** Notas de 1 a 5 por aspecto. Aspectos sem nota não entram. */
  notas: Partial<Record<Aspecto, number>>;
  trechos: TrechoEmRevisao[];
  /** O que a avaliação ensinou foi desfeito pelo usuário. */
  desfeita: boolean;
  criadoEm: string;
}

/** Números que resumem uma timeline, usados para comparar versões e deduzir correções. */
export interface Indicadores {
  duracaoSeg: number;
  clipes: number;
  duracaoMedianaDosPlanosSeg: number;
  cortesPorMinuto: number;
  /** Fração das trocas de plano feitas com transição gradual. */
  transicoesGraduais: number;
  clipesComCor: number;
  saturacaoMedia: number;
  clipesComZoom: number;
  barrasDeCinema: boolean;
  enquadramento: "preencher" | "conter" | "misto";
  legendas: number;
  tamanhoDasLegendas: number;
  legendasComCaixa: boolean;
  textos: number;
  posicaoDosTextos: "topo" | "centro" | "base" | null;
  temTrilha: boolean;
  volumeDaTrilha: number | null;
  efeitosSonoros: number;
  encerramento: "corte" | "fade";
  cta: "cartao" | "texto" | "nenhum";
}

export interface Comparacao {
  projetoId: string;
  de: number;
  para: number;
  indicadores: { de: Indicadores; para: Indicadores };
  itens: {
    adicionados: { id: string; tipo: string }[];
    removidos: { id: string; tipo: string }[];
    alterados: { id: string; tipo: string; campos: { campo: string; de: unknown; para: unknown }[] }[];
  };
  /** As diferenças em frases curtas. */
  resumo: string[];
}

/** Métricas informadas pelo usuário. Todas opcionais; nenhuma é calculada ou estimada pela aplicação. */
export interface Metricas {
  visualizacoes?: number;
  /** Retenção média, de 0 a 100. */
  retencaoPercentual?: number;
  tempoAssistidoSeg?: number;
  compartilhamentos?: number;
  comentarios?: number;
  curtidas?: number;
  cliques?: number;
  conversoes?: number;
  entradasNoDiscord?: number;
  /** Novos jogadores atribuídos à campanha. Só é aceito acompanhado de `evidenciaDeAtribuicao`. */
  novosJogadores?: number;
}

/** O que a aplicação consegue dizer de um resultado, comparando com resultados anteriores do próprio usuário. */
export interface LeituraDoResultado {
  /** "insuficiente": faltam resultados comparáveis para dizer qualquer coisa. */
  sinal: "acima" | "abaixo" | "dentro" | "insuficiente";
  metrica: "retencaoPercentual" | "engajamento" | null;
  valor: number | null;
  /** Mediana dos resultados comparáveis (mesmo perfil e plataforma). */
  referencia: number | null;
  comparaveis: number;
  /** Quantos aprendizados receberam o sinal. */
  aprendizadosSinalizados: number;
  observacao: string;
}

export interface Resultado {
  id: number;
  projetoId: string;
  exportacaoId: number | null;
  plataforma: string;
  metricas: Metricas;
  /** Como se sabe que os novos jogadores vieram desta campanha. */
  evidenciaDeAtribuicao: string;
  observacoes: string;
  leitura: LeituraDoResultado;
  criadoEm: string;
}

/** Ação do usuário sobre um aprendizado, guardada com o estado anterior para poder ser desfeita. */
export interface AcaoDeAprendizado {
  id: number;
  aprendizadoId: number;
  acao: "corrigido" | "desativado" | "ativado" | "excluido";
  /** Resumo do aprendizado antes da ação. */
  descricao: string;
  desfeita: boolean;
  criadoEm: string;
}

/** Visão do que foi aprendido, separado por contexto. */
export interface PainelDeAprendizado {
  geral: Aprendizado[];
  /** Por perfil: fivem, redm, redes-sociais, publicidade, institucional e outros. */
  perfis: Record<string, Aprendizado[]>;
  /** Por projeto. */
  projetos: Record<string, Aprendizado[]>;
  temporarias: Aprendizado[];
}
