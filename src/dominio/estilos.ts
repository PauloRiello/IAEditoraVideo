// Estilo de edição: escolhas visuais e de ritmo lidas dos JSON de IA/Estilos/.

import type { Efeito, Transicao } from "./timeline.ts";

export interface EstiloDeEdicao {
  id: string;
  nome: string;
  descricao: string;
  /** Perfis para os quais o estilo foi pensado. Não é uma restrição. */
  indicadoPara: string[];
  duracaoDoPlanoSeg: number;
  transicao: Transicao;
  /** Efeitos que o estilo propõe. A montagem decide, pelo contexto, quais realmente aplicar. */
  efeitos: Efeito[];
  zoomLentoEmPlanosParados: boolean;
  legendas: { tamanho: number; caixa: boolean };
  texto: { tamanho: number; posicao: "topo" | "centro" | "base"; animacao: "nenhuma" | "surgir" | "subir" };
  /** Como a chamada para ação aparece: texto sobre o vídeo ou cartão animado no final. */
  encerramento: "texto" | "cartao";
  fadeFinalSeg: number;
  volumeDaTrilha: number;
  volumeDaTrilhaNasFalas: number;
}
