// Tipos da memória de edição e do aprendizado controlado.

/** Assuntos sobre os quais a IA pode registrar conhecimento de edição. */
export const CATEGORIAS_EDICAO = [
  "ritmo",
  "cortes",
  "duracao-planos",
  "transicoes",
  "movimentos-camera",
  "zoom",
  "efeitos-visuais",
  "cores",
  "iluminacao",
  "tipografia",
  "legendas",
  "trilha-sonora",
  "efeitos-sonoros",
  "sincronizacao-musical",
  "narrativa",
  "hooks",
  "retencao",
  "cta",
] as const;

export type CategoriaEdicao = (typeof CATEGORIAS_EDICAO)[number];

/**
 * A quem um aprendizado se aplica:
 * - geral: a todos os projetos;
 * - especializacao: aos projetos de um perfil (por exemplo, fivem);
 * - projeto: a um único projeto;
 * - temporaria: orientação passageira, com validade opcional.
 */
export type EscopoAprendizado = "geral" | "especializacao" | "projeto" | "temporaria";

/** candidato: observado, ainda sem evidência suficiente para ser aplicado. */
export type EstadoAprendizado = "candidato" | "ativo" | "desativado";

/** De onde veio a evidência. "usuario" é uma instrução explícita. */
export type OrigemEvidencia = "feedback" | "analise" | "correcao" | "usuario";

/** Fontes distintas (projetos ou referências) exigidas para um aprendizado valer automaticamente em cada escopo amplo. */
export const PROJETOS_PARA_ATIVAR = { especializacao: 2, geral: 3 } as const;

export interface Aprendizado {
  id: number;
  escopo: EscopoAprendizado;
  perfil: string | null;
  projetoId: string | null;
  categoria: CategoriaEdicao;
  /** Identifica o assunto dentro da categoria, por exemplo "duracao-media". */
  chave: string;
  /** O que foi aprendido, em linguagem natural. */
  descricao: string;
  /** Valor estruturado, quando houver (número, texto ou objeto). */
  valor: unknown;
  /** Em que situação se aplica. */
  contexto: string;
  estado: EstadoAprendizado;
  /** De 0 a 1. */
  confianca: number;
  /** Evidências que confirmam. */
  evidencias: number;
  /** Evidências que contradizem. */
  contrarias: number;
  /** Fontes distintas (projetos ou referências) em que foi observado. */
  projetosObservados: number;
  expiraEm: string | null;
  criadoEm: string;
  atualizadoEm: string;
}

export interface Evidencia {
  id: number;
  aprendizadoId: number;
  origem: OrigemEvidencia;
  /** Projeto em que foi observada. */
  projetoId: string | null;
  /** Referência em que foi observada. */
  referenciaId: string | null;
  feedbackId: number | null;
  detalhe: string;
  confirma: boolean;
  peso: number;
  criadoEm: string;
}

/** Uma observação a registrar. Vira um aprendizado novo ou reforça um existente. */
export interface Observacao {
  escopo: EscopoAprendizado;
  perfil?: string;
  projetoId?: string;
  categoria: CategoriaEdicao;
  chave: string;
  descricao: string;
  valor?: unknown;
  contexto?: string;
  origem: OrigemEvidencia;
  /** Projeto em que foi observada (por padrão, o próprio projeto do escopo). */
  projetoObservado?: string;
  /** Referência em que foi observada (análise de referências). */
  referenciaObservada?: string;
  feedbackId?: number;
  detalhe?: string;
  /** Somente para orientações temporárias. */
  expiraEm?: string;
}

/** Aprendizados incompatíveis vindos de perfis diferentes: nenhum é aplicado automaticamente. */
export interface Conflito {
  categoria: CategoriaEdicao;
  chave: string;
  opcoes: Aprendizado[];
}

export interface ConsultaAprendizados {
  aplicaveis: Aprendizado[];
  conflitos: Conflito[];
}

export interface Referencia {
  id: string;
  titulo: string;
  /** Arquivo local, quando houver. */
  caminho: string | null;
  /** Endereço de origem, quando houver. */
  origemUrl: string | null;
  perfil: string | null;
  /** Registro de que o uso do material é autorizado. */
  autorizacao: string;
  notas: string;
  criadoEm: string;
}

export interface Analise {
  id: number;
  midiaId: string | null;
  referenciaId: string | null;
  /** Por exemplo "ritmo", "cenas", "transcricao". */
  tipo: string;
  resultado: unknown;
  criadoEm: string;
}

export interface VersaoPlano {
  id: number;
  projetoId: string;
  versao: number;
  plano: unknown;
  autor: "ia" | "usuario";
  nota: string;
  /** Só um plano aprovado pode seguir para a edição. */
  estado: "rascunho" | "aprovado" | "rejeitado";
  decididoEm: string | null;
  criadoEm: string;
}

export interface DecisaoRegistrada {
  id: number;
  projetoId: string;
  versaoDoPlano: number | null;
  tipo: "plano-gerado" | "alteracao" | "aprovacao" | "rejeicao" | "roteiro";
  descricao: string;
  criadoEm: string;
}

export interface UsoIA {
  id: number;
  projetoId: string | null;
  provedor: string;
  modelo: string;
  origem: "local" | "externo";
  capacidade: string;
  operacao: string;
  dispositivo: "gpu" | "cpu" | null;
  duracaoMs: number | null;
  sucesso: boolean;
  criadoEm: string;
}
