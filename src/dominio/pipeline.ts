// Contratos do processamento audiovisual. As implementações ficam em Pipeline/<etapa>/.

import type { PlanoDeEdicao } from "./producao.ts";
import type { Perfil, Projeto } from "./tipos.ts";

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

// O plano de edição (saída de "editing", entrada de "rendering") está em producao.ts.

/** Motor de renderização. Remotion é o principal; HyperFrames e FFmpeg são complementares. */
export interface MotorRender {
  id: "remotion" | "hyperframes" | "ffmpeg";
  disponivel(): Promise<boolean>;
  renderizar(plano: PlanoDeEdicao, arquivoDestino: string): Promise<void>;
}
