// Timeline: a descrição completa e editável de um vídeo. É só dado — referencia os
// arquivos originais pelo caminho e nunca os altera (edição não destrutiva).

import type { RetratoDaMarca } from "./marca-na-timeline.ts";

/** Formato de saída: resolução e taxa de quadros. */
export interface FormatoDaTimeline {
  largura: number;
  altura: number;
  fps: number;
}

/** Como a mídia ocupa o quadro. x e y (0 a 1) dizem que parte fica visível ao recortar. */
export interface Enquadramento {
  /** "preencher": ocupa o quadro todo, recortando o que sobra. "conter": mostra a mídia inteira, com faixas. */
  modo: "preencher" | "conter";
  x: number;
  y: number;
  /** Aproximação adicional: 1 = sem zoom. */
  zoom: number;
}

export type Efeito =
  | { tipo: "barras-de-cinema"; proporcao: number }
  | { tipo: "zoom-lento"; intensidade: number }
  | { tipo: "cor"; saturacao: number; contraste: number; brilho: number };

export interface Transicao {
  tipo: "corte" | "gradual";
  duracaoSeg: number;
}

interface ItemBase {
  id: string;
  /** Camadas maiores ficam por cima. 0 é a faixa principal de vídeo. */
  camada: number;
  inicioSeg: number;
  duracaoSeg: number;
  /** Prende o item a outro: se o outro se mover, este acompanha. */
  ancora?: { itemId: string; deslocamentoSeg: number };
  /** "marca": o item inteiro veio da marca (logo, encerramento) e sai ao reaplicar a marca. */
  origem?: "marca";
  /** Campos que a marca mudou, com o valor de antes; editar um deles à mão o tira daqui. */
  daMarca?: Record<string, unknown>;
  /** Campos que a marca tinha mudado e o usuário editou depois: a marca não mexe mais neles. */
  editadoAMao?: string[];
}

interface ItemVisual extends ItemBase {
  enquadramento: Enquadramento;
  entrada: Transicao;
  /** "fade": termina escurecendo. */
  saida: { tipo: "corte" | "fade"; duracaoSeg: number };
  efeitos: Efeito[];
}

export interface ItemVideo extends ItemVisual {
  tipo: "video";
  arquivo: string;
  midiaId?: string;
  /** Ponto do arquivo original em que o trecho começa. */
  inicioOrigemSeg: number;
  /** 1 = normal; 0,5 = câmera lenta; 2 = acelerado. */
  velocidade: number;
  /** 0 = mudo; 1 = volume original. */
  volume: number;
}

export interface ItemImagem extends ItemVisual {
  tipo: "imagem";
  arquivo: string;
  /** Imagem por cima do vídeo (logo), numa caixa em frações do quadro, sem fundo. */
  sobreposicao?: { x: number; y: number; largura: number; altura: number; opacidade: number; alinhamento: "esquerda" | "direita" };
}

/** Cartão animado em HTML/CSS/GSAP, renderizado pelo HyperFrames antes da composição. */
export interface ItemCartao extends ItemVisual {
  tipo: "cartao";
  titulo: string;
  subtitulo: string;
  corDeFundo: string;
  corDoTexto: string;
  /** Logo da marca no cartão. */
  logo?: string;
  /** Família da fonte (registrada em timeline.marca). */
  fonte?: string;
}

export interface ItemTexto extends ItemBase {
  tipo: "texto";
  texto: string;
  posicao: "topo" | "centro" | "base";
  /** Altura da letra como fração da altura do quadro. */
  tamanho: number;
  cor: string;
  /** Cor da caixa atrás do texto, ou vazio para nenhuma. */
  fundo: string;
  /** Família da fonte (registrada em timeline.marca). Sem ela, a padrão. */
  fonte?: string;
  animacao: "nenhuma" | "surgir" | "subir";
}

export interface ItemLegenda extends ItemBase {
  tipo: "legenda";
  texto: string;
}

export interface ItemAudio extends ItemBase {
  tipo: "audio";
  papel: "trilha" | "efeito-sonoro" | "narracao";
  arquivo: string;
  inicioOrigemSeg: number;
  volume: number;
  fadeDeEntradaSeg: number;
  fadeDeSaidaSeg: number;
  /** Trechos da timeline em que o volume cai para `volumeReduzido` (por exemplo, durante falas). */
  reduzirEm: { inicioSeg: number; fimSeg: number }[];
  volumeReduzido: number;
}

export type ItemDaTimeline = ItemVideo | ItemImagem | ItemCartao | ItemTexto | ItemLegenda | ItemAudio;

export interface Timeline {
  versao: 1;
  formato: FormatoDaTimeline;
  duracaoSeg: number;
  itens: ItemDaTimeline[];
  /** Efeitos aplicados ao vídeo inteiro. */
  efeitosGlobais: Efeito[];
  /** Estilo visual das legendas. Cor, fundo e fonte vêm da marca, quando houver. */
  legendas: { tamanho: number; caixa: boolean; cor?: string; fundo?: string; fonte?: string; daMarca?: Record<string, unknown>; editadoAMao?: string[] };
  /** Retrato da marca aplicada: o render usa só isto, nunca a marca atual. */
  marca?: { id: string; atualizadaEm: string; fontes: { familia: string; arquivo: string }[] };
  /** Margens que textos e legendas respeitam, como fração do quadro. Ausente = margens padrão. */
  areaSegura?: AreaSegura;
}

export interface AreaSegura {
  topo: number;
  base: number;
  lados: number;
}

/** Margens usadas quando a timeline não define as suas. */
export const AREA_SEGURA_PADRAO: AreaSegura = { topo: 0.08, base: 0.14, lados: 0.06 };

/** Uma alteração na timeline. Cada operação gera uma nova versão; a anterior é preservada. */
export type Operacao =
  | { tipo: "inserir"; item: ItemDaTimeline }
  | { tipo: "remover"; id: string }
  /** Corta o trecho: novos pontos de início e/ou fim, em segundos a partir do início atual do item. */
  | { tipo: "cortar"; id: string; inicioSeg?: number; fimSeg?: number }
  | { tipo: "dividir"; id: string; emSeg: number }
  | { tipo: "ajustar-duracao"; id: string; duracaoSeg: number }
  /** Muda a ordem de um clipe na faixa principal. */
  | { tipo: "reposicionar"; id: string; posicao: number }
  /** Move um item livre (texto, áudio, sobreposição) para outro instante. */
  | { tipo: "mover"; id: string; inicioSeg: number }
  | { tipo: "mudar-camada"; id: string; camada: number }
  | { tipo: "alterar"; id: string; campos: Record<string, unknown> }
  | { tipo: "efeito-global"; efeito: Efeito; remover?: boolean }
  | { tipo: "formato"; formato: Partial<FormatoDaTimeline> }
  /** Muda as margens de textos e legendas e/ou o estilo das legendas. */
  | { tipo: "apresentacao"; areaSegura?: Partial<AreaSegura>; legendas?: Partial<Timeline["legendas"]> }
  /** Troca o que veio da marca pelo retrato atual dela, sem mexer nas edições manuais. */
  | { tipo: "aplicar-marca"; marca: RetratoDaMarca | null };

export interface VersaoDaTimeline {
  projetoId: string;
  versao: number;
  timeline: Timeline;
  autor: "ia" | "usuario";
  nota: string;
  criadoEm: string;
}

export type EstadoDaExportacao = "na-fila" | "renderizando" | "concluida" | "falhou" | "cancelada";

export interface Exportacao {
  id: number;
  projetoId: string;
  versaoDaTimeline: number;
  tipo: "previa" | "final";
  estado: EstadoDaExportacao;
  /** De 0 a 1. */
  progresso: number;
  arquivo: string | null;
  largura: number | null;
  altura: number | null;
  fps: number | null;
  duracaoSeg: number | null;
  tamanhoBytes: number | null;
  /** Resultado da conferência do arquivo exportado. */
  verificacao: { aprovada: boolean; problemas: string[] } | null;
  erro: string | null;
  /** Quantas tentativas foram feitas (uma falha leva a nova tentativa em modo mais conservador). */
  tentativas: number;
  /** Preset de exportação usado, se houver. */
  preset: string | null;
  criadoEm: string;
  concluidoEm: string | null;
}
