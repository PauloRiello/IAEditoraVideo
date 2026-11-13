// Tipos do relatório de análise de uma referência.
// Toda característica informa se foi medida ou interpretada, com que método e confiança.

import type { CategoriaEdicao } from "./memoria.ts";

/**
 * - observado: medido diretamente no arquivo (sinal de vídeo ou de áudio);
 * - estimado: interpretação por heurística ou por modelo de IA;
 * - nao-avaliado: exigiria um recurso indisponível (por exemplo, um modelo visual);
 * - nao-aplicavel: não faz sentido para este tipo de vídeo.
 */
export type Base = "observado" | "estimado" | "nao-avaliado" | "nao-aplicavel";

export interface Caracteristica<T = unknown> {
  valor: T | null;
  base: Base;
  /** De 0 a 1. */
  confianca: number;
  /** Como o valor foi obtido, ou por que não foi. */
  metodo: string;
}

const arredondar = (n: number) => Math.round(n * 100) / 100;
export const observado = <T>(valor: T, metodo: string, confianca = 0.9): Caracteristica<T> => ({ valor, base: "observado", confianca: arredondar(confianca), metodo });
export const estimado = <T>(valor: T, metodo: string, confianca: number): Caracteristica<T> => ({ valor, base: "estimado", confianca: arredondar(confianca), metodo });
export const naoAvaliado = <T = string>(motivo: string): Caracteristica<T> => ({ valor: null, base: "nao-avaliado", confianca: 0, metodo: motivo });
export const naoAplicavel = <T = string>(motivo: string): Caracteristica<T> => ({ valor: null, base: "nao-aplicavel", confianca: 0, metodo: motivo });

export interface DadosTecnicos {
  duracaoSeg: number;
  largura: number;
  altura: number;
  fps: number;
  proporcao: string;
  orientacao: "vertical" | "horizontal" | "quadrado";
  codecVideo: string;
  codecAudio: string | null;
  taxaDeBitsKbps: number | null;
  temAudio: boolean;
  faixasDeLegenda: number;
}

export type TipoTransicao = "corte-seco" | "gradual" | "fade-preto";
export interface Transicao { tempoSeg: number; tipo: TipoTransicao; duracaoSeg: number }

export type Movimento = "estatico" | "panoramica" | "zoom-in" | "zoom-out" | "complexo";
export interface Plano { inicioSeg: number; fimSeg: number; duracaoSeg: number; movimento: Movimento | null }

export interface Ritmo {
  planos: number;
  cortesPorMinuto: number;
  duracaoMediaSeg: number;
  duracaoMedianaSeg: number;
  duracaoMinimaSeg: number;
  duracaoMaximaSeg: number;
  /** Cortes por minuto no início, no meio e no fim do vídeo. */
  porTerco: [number, number, number];
  progressao: "acelera" | "desacelera" | "constante";
}

export interface AnaliseVisual {
  amostragem: { quadrosPorSegundo: number; resolucao: string; quadrosAnalisados: number; quadrosDoVideo: number; quadrosChave: string[] };
  planos: Plano[];
  transicoes: Transicao[];
  ritmo: Caracteristica<Ritmo>;
  tiposDeTransicao: Caracteristica<Record<TipoTransicao, number>>;
  /** Fração do tempo em cada tipo de movimento. */
  movimentoDeCamera: Caracteristica<Record<Movimento, number>>;
  cor: Caracteristica<{ saturacao: number; classificacaoSaturacao: string; temperatura: string; coresDominantes: { hex: string; fracao: number }[] }>;
  iluminacao: Caracteristica<{ brilho: number; contraste: number; classificacaoBrilho: string; classificacaoContraste: string }>;
  composicao: Caracteristica<{ barrasDeCinema: boolean; proporcaoUtil: string }>;
  enquadramentos: Caracteristica<string>;
  efeitos: Caracteristica<string>;
  tipografia: Caracteristica<string>;
  legendas: Caracteristica<string>;
  animacoes: Caracteristica<string>;
}

export interface Intervalo { inicioSeg: number; fimSeg: number }
export interface MudancaDeIntensidade { tempoSeg: number; tipo: "aumento" | "queda"; variacaoDb: number }

export interface Transcricao {
  idioma: string;
  texto: string;
  tempoDeFalaSeg: number;
  segmentos: { inicioSeg: number; fimSeg: number; texto: string }[];
}

export interface AnaliseAudio {
  volume: Caracteristica<{ picoDb: number; medioDb: number; faixaDinamicaDb: number }>;
  silencios: Caracteristica<Intervalo[]>;
  mudancasDeIntensidade: Caracteristica<MudancaDeIntensidade[]>;
  /** Volume médio por segundo, em dBFS. */
  curvaDeIntensidadeDb: number[];
  batidas: Caracteristica<{ ataques: number; regularidade: number; bpm: number | null }>;
  /** Instantes em que um corte cairia sobre um ataque sonoro forte. */
  pontosDeCorteMusical: Caracteristica<number[]>;
  sincroniaComCortes: Caracteristica<{ cortesNaBatida: number; cortesAvaliados: number; fracao: number; fracaoEsperadaAoAcaso: number }>;
  trilhaSonora: Caracteristica<string>;
  efeitosSonoros: Caracteristica<string>;
  fala: Caracteristica<Transcricao>;
  dialogosENarracao: Caracteristica<string>;
}

export interface ElementoNarrativo { descricao: string; inicioSeg?: number }

export interface AnaliseNarrativa {
  /** "curta": vídeo curto de divulgação, em que gancho e CTA são esperados. "livre": demais formatos. */
  estrutura: "curta" | "livre";
  hook: Caracteristica<ElementoNarrativo>;
  desenvolvimento: Caracteristica<ElementoNarrativo>;
  progressao: Caracteristica<ElementoNarrativo>;
  destaques: Caracteristica<ElementoNarrativo[]>;
  suspense: Caracteristica<ElementoNarrativo>;
  humor: Caracteristica<ElementoNarrativo>;
  emocao: Caracteristica<ElementoNarrativo>;
  climax: Caracteristica<ElementoNarrativo>;
  encerramento: Caracteristica<ElementoNarrativo>;
  cta: Caracteristica<ElementoNarrativo>;
}

/** Princípio de edição extraído da referência, aplicável a outros materiais. */
export interface RegraDeEdicao {
  categoria: CategoriaEdicao;
  chave: string;
  /** Faixa qualitativa (por exemplo "rapido"), para que referências parecidas se confirmem. */
  valor: string;
  descricao: string;
  /** Como aplicar o princípio em outro vídeo. */
  exemplo: string;
  base: "observado" | "estimado";
  confianca: number;
}

export interface RelatorioReferencia {
  versao: 1;
  referencia: { id: string | null; titulo: string; arquivo: string };
  perfil: string;
  analisadoEm: string;
  tecnico: DadosTecnicos;
  visual: AnaliseVisual;
  audio: AnaliseAudio | null;
  narrativa: AnaliseNarrativa;
  /** Tipos de conteúdo reconhecidos segundo o perfil (por exemplo trailer, gameplay). */
  tiposDeConteudo: Caracteristica<{ id: string; nome: string; pontuacao: number }[]>;
  /** Resumo qualitativo do estilo: uma faixa por aspecto. */
  perfilDeEstilo: Record<string, string>;
  regras: RegraDeEdicao[];
  confiancaGeral: number;
  /** Modelos de IA usados nesta análise. */
  modelosUsados: string[];
  /** O que não pôde ser avaliado e por quê. */
  limitacoes: string[];
}
