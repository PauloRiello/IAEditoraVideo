import type React from "react";
import { Composition } from "remotion";
import type { Timeline } from "../../../src/dominio/timeline.ts";
import { VideoDaTimeline, type PropriedadesDoVideo } from "./Video.tsx";

const VAZIA: Timeline = {
  versao: 1, formato: { largura: 1080, altura: 1920, fps: 30 }, duracaoSeg: 1, itens: [], efeitosGlobais: [], legendas: { tamanho: 0.035, caixa: true },
};

// Uma única composição: resolução, taxa de quadros e duração vêm da timeline recebida.
export const Raiz: React.FC = () => (
  <Composition
    id="Timeline"
    component={VideoDaTimeline}
    defaultProps={{ timeline: VAZIA, arquivos: {} } satisfies PropriedadesDoVideo}
    width={VAZIA.formato.largura}
    height={VAZIA.formato.altura}
    fps={VAZIA.formato.fps}
    durationInFrames={30}
    calculateMetadata={({ props }) => ({
      width: props.timeline.formato.largura,
      height: props.timeline.formato.altura,
      fps: props.timeline.formato.fps,
      durationInFrames: Math.max(1, Math.round(props.timeline.duracaoSeg * props.timeline.formato.fps)),
    })}
  />
);
