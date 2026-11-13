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
