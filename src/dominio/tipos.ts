// Entidades do domínio. Somente tipos: nada aqui acessa disco, rede ou banco.

/** Formato de saída de um vídeo (por exemplo, vertical para Instagram e TikTok). */
export interface FormatoSaida {
  id: string;
  nome: string;
  largura: number;
  altura: number;
  fps: number;
  duracaoMaximaSeg?: number;
}

/**
 * Perfil de especialização: adapta a edição a um tipo de conteúdo (FiveM, RedM,
 * institucional...). É dado configurável em IA/Perfis, não código.
 */
export interface Perfil {
  id: string;
  nome: string;
  descricao: string;
  formatoPadrao: string;
  formatos: FormatoSaida[];
  /** Orientações de estilo usadas no planejamento da edição. */
  diretrizes: string[];
  /** Como analisar referências deste perfil. */
  analise?: ConfiguracaoDeAnalise;
  /** Ângulos que um roteiro deste perfil pode explorar, se o material sustentar. */
  angulosDeRoteiro?: string[];
}

/** Tipo de conteúdo reconhecível em um perfil (por exemplo trailer ou gameplay). */
export interface TipoDeConteudo {
  id: string;
  nome: string;
  /** Sinais medidos que indicam o tipo, por exemplo "ritmo-rapido" ou "barras-de-cinema". */
  sinais: string[];
  /** Palavras que, ditas no vídeo, indicam o tipo. */
  palavras?: string[];
}

export interface ConfiguracaoDeAnalise {
  /**
   * "curta": espera gancho e chamada para ação. "livre": não espera.
   * "automatica": decide pela duração e pela orientação do vídeo.
   */
  estrutura: "curta" | "livre" | "automatica";
  /** Palavras que indicam chamada para ação. */
  palavrasDeCta?: string[];
  tiposDeConteudo?: TipoDeConteudo[];
}

export interface Projeto {
  id: string;
  nome: string;
  perfil: string;
  formato: string;
  criadoEm: string;
  atualizadoEm: string;
}

export type TipoMidia = "bruto" | "referencia" | "exportacao";

export interface Midia {
  id: string;
  projetoId: string;
  tipo: TipoMidia;
  caminho: string;
  metadados: Record<string, unknown> | null;
  criadoEm: string;
}

export interface Feedback {
  id: number;
  projetoId: string;
  nota: number;
  comentario: string;
  criadoEm: string;
}
