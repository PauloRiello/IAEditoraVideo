// Tipos da preparação de um vídeo: arquivos brutos, análise de conteúdo, índice de
// pesquisa, briefing, plano de edição e roteiro.

import type { Caracteristica, DadosTecnicos, Intervalo, Movimento, Transcricao } from "./analise.ts";
import type { FormatoSaida } from "./tipos.ts";

/**
 * Agente: componente da aplicação com uma única responsabilidade. Trabalha no computador
 * do usuário, por medição e regras, e usa provedores de IA apenas quando disponíveis.
 */
export interface Agente {
  id: string;
  nome: string;
  responsabilidade: string;
}

// --- Agente de Arquivos -------------------------------------------------------------

export interface Problema {
  codigo: string;
  descricao: string;
  gravidade: "aviso" | "erro";
  inicioSeg?: number;
  fimSeg?: number;
}

export interface ArquivoBruto {
  nome: string;
  caminho: string;
  /** Formato do contêiner, por exemplo "mp4" ou "webm". */
  formato: string;
  tamanhoBytes: number;
  /** Ausente quando o arquivo não pôde ser lido. */
  tecnico: DadosTecnicos | null;
  audio: { codec: string; canais: number; taxaHz: number } | null;
  integridade: "integro" | "com-erros" | "ilegivel";
  /** Como a integridade foi verificada. */
  verificacao: string;
  problemas: Problema[];
}

// --- Agente de Conteúdo -------------------------------------------------------------

/** Trecho contínuo de até 8 s: um plano, ou parte de um plano longo. */
export interface Cena {
  indice: number;
  inicioSeg: number;
  fimSeg: number;
  duracaoSeg: number;
  movimento: Movimento | null;
  /** Intensidade de movimento na imagem, de 0 a 1. */
  acao: number;
  volumeDb: number | null;
  /** Fala transcrita dentro do trecho. */
  fala: string;
  /** Personagens e elementos visuais, quando há modelo visual. */
  elementos: string[];
  miniatura: string | null;
  /** Relevância estimada para a edição, de 0 a 1. */
  pontuacao: number;
  etiquetas: string[];
}

export interface AnaliseDeConteudo {
  midiaId: string;
  cenas: Cena[];
  silencios: Intervalo[];
  transcricao: Transcricao | null;
  momentosDeAcao: (Intervalo & { intensidade: number })[];
  /** Índices das cenas mais relevantes. */
  destaques: number[];
  possiveisErros: Problema[];
  personagensEElementos: Caracteristica<string[]>;
  humor: Caracteristica<{ inicioSeg: number; fimSeg: number; texto: string }[]>;
  limitacoes: string[];
}

export interface EntradaDoIndice {
  tipo: "arquivo" | "cena" | "fala" | "acao" | "silencio" | "problema";
  inicioSeg: number;
  fimSeg: number;
  texto: string;
  etiquetas: string[];
  pontuacao: number;
}

export interface ResultadoDaPesquisa extends EntradaDoIndice {
  midiaId: string;
  projetoId: string;
  arquivo: string;
}

// --- Agente de Planejamento ---------------------------------------------------------

/** O que o usuário quer do vídeo. Só o objetivo é obrigatório. */
export interface Briefing {
  objetivo: string;
  publico?: string;
  plataforma?: string;
  duracaoDesejadaSeg?: number;
  /** Texto da chamada para ação. Sem ele, nenhum CTA é inventado. */
  cta?: string;
  /** Fatos verdadeiros que podem aparecer no vídeo (nome do servidor, novidades, datas). */
  fatos?: string[];
  /** Estilos de edição desejados (por exemplo "acao", "trailer"). Orientam o ritmo do plano. */
  estilos?: string[];
}

export type Bloco = "abertura" | "desenvolvimento" | "climax" | "encerramento";

export interface Clipe {
  midiaId: string;
  arquivo: string;
  inicioOrigemSeg: number;
  fimOrigemSeg: number;
  inicioLinhaDoTempoSeg: number;
  bloco: Bloco;
  /** Por que este trecho foi escolhido. */
  motivo: string;
  transicaoDeEntrada: "nenhuma" | "corte-seco" | "gradual";
}

/** De onde veio uma escolha do plano. */
export interface Decisao {
  aspecto: string;
  decisao: string;
  origem: "briefing" | "aprendizado" | "referencia" | "perfil" | "padrao";
  aprendizadoId?: number;
}

export interface PlanoDeEdicao {
  versao: 1;
  objetivo: string;
  publico: string;
  plataforma: string;
  formato: FormatoSaida;
  duracaoDesejadaSeg: number;
  duracaoPlanejadaSeg: number;
  estruturaNarrativa: { bloco: Bloco; inicioSeg: number; fimSeg: number; descricao: string }[];
  clipes: Clipe[];
  transicoes: { padrao: "corte-seco" | "gradual" | "misto"; encerramento: "corte" | "fade-preto" };
  audio: { audioOriginal: "manter" | "remover"; descricao: string };
  legendas: { ativas: boolean; itens: { inicioSeg: number; fimSeg: number; texto: string }[]; observacao: string };
  efeitos: string[];
  trilhaSonora: { recomendada: boolean; andamento: string | null; sincronizarCortesComBatidas: boolean; arquivo: string | null; observacao: string };
  cta: { texto: string; inicioSeg: number } | null;
  decisoes: Decisao[];
  avisos: string[];
}

// --- Agente de Roteiro --------------------------------------------------------------

/** Informação verificável que o roteiro pode usar. Nada fora desta lista entra no texto. */
export interface Fato {
  id: string;
  origem: "briefing" | "fala" | "cena";
  texto: string;
}

export interface LinhaDoRoteiro {
  bloco: Bloco;
  tipo: "narracao" | "texto-na-tela" | "fala-original" | "imagem";
  texto: string;
  /** Identificadores dos fatos que sustentam a linha. */
  baseadoEm: string[];
}

export interface Roteiro {
  projetoId: string;
  /** "modelo": escrito por modelo de linguagem e conferido. "estrutura": montado sem modelo. */
  base: "modelo" | "estrutura";
  /** Ângulos sugeridos pelo perfil (por exemplo humor, imersão, recrutamento). */
  angulos: string[];
  linhas: LinhaDoRoteiro[];
  fatos: Fato[];
  avisos: string[];
  criadoEm: string;
}
