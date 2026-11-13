// Contratos do processamento audiovisual. As implementações ficam em Pipeline/<etapa>/.

import type { FormatoSaida, Perfil, Projeto } from "./tipos.ts";

/** Etapas do pipeline, na ordem de execução. Os nomes são os das pastas em Pipeline/. */
export const ORDEM_ETAPAS = [
  "ingestion",
  "analysis",
  "transcription",
  "editing",
  "rendering",
  "quality-control",
] as const;

export type EtapaId = (typeof ORDEM_ETAPAS)[number];

export interface ContextoEtapa {
  projeto: Projeto;
  perfil: Perfil;
  /** Último resultado concluído de cada etapa anterior. */
  resultados: Partial<Record<EtapaId, unknown>>;
}

/** Uma etapa recebe os resultados anteriores e devolve o seu, serializável em JSON. */
export interface EtapaPipeline {
  id: EtapaId;
  descricao: string;
  executar(contexto: ContextoEtapa): Promise<unknown>;
}

/** Trecho de uma mídia de origem posicionado na linha do tempo. */
export interface Clipe {
  midiaId: string;
  inicioOrigemSeg: number;
  fimOrigemSeg: number;
  inicioLinhaDoTempoSeg: number;
}

/** Saída da etapa "editing" e entrada da etapa "rendering". */
export interface PlanoDeEdicao {
  versao: 1;
  formato: FormatoSaida;
  clipes: Clipe[];
}

/** Motor de renderização. Remotion é o principal; HyperFrames e FFmpeg são complementares. */
export interface MotorRender {
  id: "remotion" | "hyperframes" | "ffmpeg";
  disponivel(): Promise<boolean>;
  renderizar(plano: PlanoDeEdicao, arquivoDestino: string): Promise<void>;
}
