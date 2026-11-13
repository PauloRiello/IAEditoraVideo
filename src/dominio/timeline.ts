// Timeline: a descrição completa e editável de um vídeo. É só dado — referencia os
// arquivos originais pelo caminho e nunca os altera (edição não destrutiva).

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
}

/** Cartão animado em HTML/CSS/GSAP, renderizado pelo HyperFrames antes da composição. */
export interface ItemCartao extends ItemVisual {
  tipo: "cartao";
  titulo: string;
  subtitulo: string;
  corDeFundo: string;
  corDoTexto: string;
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
  /** Estilo visual das legendas. */
  legendas: { tamanho: number; caixa: boolean };
}

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
  | { tipo: "formato"; formato: Partial<FormatoDaTimeline> };

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
  criadoEm: string;
  concluidoEm: string | null;
}
