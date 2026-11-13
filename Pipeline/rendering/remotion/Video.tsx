// Composição do vídeo: desenha cada item da timeline na sua camada e no seu tempo.

import type React from "react";
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Efeito, ItemAudio, ItemCartao, ItemDaTimeline, ItemImagem, ItemLegenda, ItemTexto, ItemVideo, Timeline } from "../../../src/dominio/timeline.ts";

export interface PropriedadesDoVideo extends Record<string, unknown> {
  timeline: Timeline;
  /** Para cada item com mídia, o caminho do trecho preparado, relativo à pasta pública. */
  arquivos: Record<string, string>;
}

const LIMITE = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const quadros = (segundos: number, fps: number) => Math.max(1, Math.round(segundos * fps));

/** Vídeo, imagem ou cartão: enquadramento, entrada e saída graduais, zoom lento e cor. */
const Visual: React.FC<{ item: ItemVideo | ItemImagem | ItemCartao; arquivo: string }> = ({ item, arquivo }) => {
  const quadro = useCurrentFrame();
  const { fps } = useVideoConfig();
  const total = quadros(item.duracaoSeg, fps);
  const entrada = item.entrada.tipo === "gradual" ? quadros(item.entrada.duracaoSeg, fps) : 0;
  const saida = item.saida.tipo === "fade" ? quadros(item.saida.duracaoSeg, fps) : 0;
  const presenca = (q: number) =>
    Math.min(entrada ? interpolate(q, [0, entrada], [0, 1], LIMITE) : 1, saida ? interpolate(q, [total - saida, total], [1, 0], LIMITE) : 1);

  const zoomLento = item.efeitos.find((e): e is Extract<Efeito, { tipo: "zoom-lento" }> => e.tipo === "zoom-lento");
  const cor = item.efeitos.find((e): e is Extract<Efeito, { tipo: "cor" }> => e.tipo === "cor");
  const escala = item.enquadramento.zoom * (zoomLento ? 1 + zoomLento.intensidade * (quadro / total) : 1);
  const posicao = `${item.enquadramento.x * 100}% ${item.enquadramento.y * 100}%`;
  const estilo: React.CSSProperties = {
    width: "100%", height: "100%", objectFit: item.enquadramento.modo === "preencher" ? "cover" : "contain", objectPosition: posicao,
    transform: `scale(${escala})`, transformOrigin: posicao,
    filter: cor ? `saturate(${cor.saturacao}) contrast(${cor.contraste}) brightness(${cor.brilho})` : undefined,
  };
  return (
    <AbsoluteFill style={{ opacity: presenca(quadro), backgroundColor: "black", overflow: "hidden" }}>
      {item.tipo === "imagem" ? (
        <Img src={staticFile(arquivo)} style={estilo} />
      ) : (
        <OffthreadVideo
          src={staticFile(arquivo)}
          style={estilo}
          playbackRate={item.tipo === "video" ? item.velocidade : 1}
          volume={(q) => (item.tipo === "video" ? item.volume * presenca(q) : 0)}
        />
      )}
    </AbsoluteFill>
  );
};

const Texto: React.FC<{ item: ItemTexto }> = ({ item }) => {
  const quadro = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const total = quadros(item.duracaoSeg, fps);
  const transicao = Math.min(quadros(0.35, fps), Math.floor(total / 2));
  const animado = item.animacao !== "nenhuma";
  const presenca = animado ? Math.min(interpolate(quadro, [0, transicao], [0, 1], LIMITE), interpolate(quadro, [total - transicao, total], [1, 0], LIMITE)) : 1;
  const subida = item.animacao === "subir" ? interpolate(quadro, [0, transicao], [height * 0.04, 0], LIMITE) : 0;
  return (
    <AbsoluteFill
      style={{
        alignItems: "center", padding: `${height * 0.08}px 6%`,
        justifyContent: item.posicao === "topo" ? "flex-start" : item.posicao === "base" ? "flex-end" : "center",
      }}
    >
      <div
        style={{
          opacity: presenca, transform: `translateY(${subida}px)`, color: item.cor, fontSize: height * item.tamanho, fontWeight: 800,
          fontFamily: "Arial, Helvetica, sans-serif", textAlign: "center", lineHeight: 1.15, textShadow: "0 2px 12px rgba(0,0,0,0.75)",
          backgroundColor: item.fundo || undefined, padding: item.fundo ? "0.3em 0.6em" : 0, borderRadius: "0.25em",
        }}
      >
        {item.texto}
      </div>
    </AbsoluteFill>
  );
};

const Legenda: React.FC<{ item: ItemLegenda; estilo: Timeline["legendas"] }> = ({ item, estilo }) => {
  const { height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", padding: `0 7% ${height * 0.14}px` }}>
      <div
        style={{
          color: "white", fontSize: height * estilo.tamanho, fontWeight: 700, fontFamily: "Arial, Helvetica, sans-serif", textAlign: "center", lineHeight: 1.25,
          backgroundColor: estilo.caixa ? "rgba(0,0,0,0.65)" : undefined, padding: "0.25em 0.55em", borderRadius: "0.2em",
          textShadow: estilo.caixa ? undefined : "0 2px 8px rgba(0,0,0,0.9)",
        }}
      >
        {item.texto}
      </div>
    </AbsoluteFill>
  );
};

/** Áudio com fades e redução de volume durante as falas. Recebe o instante de início do item na timeline. */
const Som: React.FC<{ item: ItemAudio; arquivo: string }> = ({ item, arquivo }) => {
  const { fps } = useVideoConfig();
  const total = quadros(item.duracaoSeg, fps);
  const volume = (q: number) => {
    const instante = item.inicioSeg + q / fps;
    const base = item.reduzirEm.some((trecho) => instante >= trecho.inicioSeg && instante < trecho.fimSeg) ? item.volumeReduzido : item.volume;
    const entrada = item.fadeDeEntradaSeg > 0 ? interpolate(q, [0, quadros(item.fadeDeEntradaSeg, fps)], [0, 1], LIMITE) : 1;
    const saida = item.fadeDeSaidaSeg > 0 ? interpolate(q, [total - quadros(item.fadeDeSaidaSeg, fps), total], [1, 0], LIMITE) : 1;
    return base * entrada * saida;
  };
  return <Audio src={staticFile(arquivo)} volume={volume} />;
};

const BarrasDeCinema: React.FC<{ proporcao: number }> = ({ proporcao }) => {
  const { width, height } = useVideoConfig();
  const altura = Math.max(0, (height - width / proporcao) / 2);
  if (altura === 0) return null;
  return (
    <AbsoluteFill style={{ justifyContent: "space-between" }}>
      <div style={{ height: altura, backgroundColor: "black" }} />
      <div style={{ height: altura, backgroundColor: "black" }} />
    </AbsoluteFill>
  );
};

const eVisual = (item: ItemDaTimeline): item is ItemVideo | ItemImagem | ItemCartao => item.tipo === "video" || item.tipo === "imagem" || item.tipo === "cartao";

export const VideoDaTimeline: React.FC<PropriedadesDoVideo> = ({ timeline, arquivos }) => {
  const { fps } = timeline.formato;
  const ordenados = [...timeline.itens].sort((a, b) => a.camada - b.camada || a.inicioSeg - b.inicioSeg);
  const barras = timeline.efeitosGlobais.find((e): e is Extract<Efeito, { tipo: "barras-de-cinema" }> => e.tipo === "barras-de-cinema");
  const sequencia = (item: ItemDaTimeline, conteudo: React.ReactNode) => (
    <Sequence key={item.id} from={Math.round(item.inicioSeg * fps)} durationInFrames={quadros(item.duracaoSeg, fps)}>
      {conteudo}
    </Sequence>
  );
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {ordenados.filter(eVisual).map((item) => (arquivos[item.id] ? sequencia(item, <Visual item={item} arquivo={arquivos[item.id]} />) : null))}
      {barras ? <BarrasDeCinema proporcao={barras.proporcao} /> : null}
      {ordenados.map((item) =>
        item.tipo === "legenda" ? sequencia(item, <Legenda item={item} estilo={timeline.legendas} />) : item.tipo === "texto" ? sequencia(item, <Texto item={item} />) : null,
      )}
      {ordenados.map((item) => (item.tipo === "audio" && arquivos[item.id] ? sequencia(item, <Som item={item} arquivo={arquivos[item.id]} />) : null))}
    </AbsoluteFill>
  );
};
