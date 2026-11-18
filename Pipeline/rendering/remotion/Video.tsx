// Composição do vídeo: desenha cada item da timeline na sua camada e no seu tempo.

import React from "react";
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, continueRender, delayRender, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { AreaSegura, Efeito, ItemAudio, ItemCartao, ItemDaTimeline, ItemImagem, ItemLegenda, ItemTexto, ItemVideo, Timeline } from "../../../src/dominio/timeline.ts";

// Mesmos valores de AREA_SEGURA_PADRAO em src/dominio/timeline.ts (este arquivo só importa tipos de lá).
const MARGENS_PADRAO: AreaSegura = { topo: 0.08, base: 0.14, lados: 0.06 };

export interface PropriedadesDoVideo extends Record<string, unknown> {
  timeline: Timeline;
  /** Para cada item com mídia, o caminho do trecho preparado, relativo à pasta pública. */
  arquivos: Record<string, string>;
}

const LIMITE = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const PADRAO = "Arial, Helvetica, sans-serif";
/** Família da fonte da marca, com a padrão como reserva. */
const familia = (nome?: string) => (nome ? `"${nome}", ${PADRAO}` : PADRAO);
const eVideo = (arquivo: string) => arquivo.endsWith(".webm") || arquivo.endsWith(".mp4");

/** Carrega as fontes da marca antes do primeiro quadro (o render espera por elas). */
const FontesDaMarca: React.FC<{ timeline: Timeline; arquivos: Record<string, string> }> = ({ timeline, arquivos }) => {
  const [espera] = React.useState(() => ((timeline.marca?.fontes.length ?? 0) > 0 ? delayRender("Carregando as fontes da marca") : null));
  React.useEffect(() => {
    if (espera === null) return;
    const cargas = (timeline.marca?.fontes ?? []).flatMap((f, n) => {
      const arquivo = arquivos[`fonte:${n}`];
      if (!arquivo) return [];
      const peso = /-(\d00)(?:-|\.)/.exec(f.arquivo)?.[1] ?? "normal";
      const face = new FontFace(f.familia, `url("${staticFile(arquivo)}")`, { weight: peso });
      return [face.load().then((carregada) => { (document.fonts as unknown as { add(f: FontFace): void }).add(carregada); }).catch((erro) => console.error(`Fonte ${f.familia} não carregou: ${erro}`))];
    });
    void Promise.all(cargas).finally(() => continueRender(espera));
  }, [espera, timeline, arquivos]);
  return null;
};

/** Logo (ou outra imagem) por cima do vídeo, numa caixa do quadro, sem fundo. */
const Sobreposicao: React.FC<{ item: ItemImagem; arquivo: string }> = ({ item, arquivo }) => {
  const { width, height } = useVideoConfig();
  const s = item.sobreposicao!;
  const estilo: React.CSSProperties = { width: "100%", height: "100%", objectFit: "contain", objectPosition: `${s.alinhamento === "direita" ? "right" : "left"} center` };
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: s.x * width, top: s.y * height, width: s.largura * width, height: s.altura * height, opacity: s.opacidade }}>
        {eVideo(arquivo) ? <OffthreadVideo src={staticFile(arquivo)} style={estilo} transparent muted /> : <Img src={staticFile(arquivo)} style={estilo} />}
      </div>
    </AbsoluteFill>
  );
};
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

/**
 * Cartão desenhado pela própria composição, com o mesmo conteúdo e a mesma entrada do
 * cartão do HyperFrames. Usado quando o HyperFrames não pôde gerar o trecho neste computador.
 */
const CartaoDesenhado: React.FC<{ item: ItemCartao; logo?: string }> = ({ item, logo }) => {
  const quadro = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const base = Math.min(width, height);
  const total = quadros(item.duracaoSeg, fps);
  const surgir = (inicioSeg: number, duracaoSeg: number) => interpolate(quadro, [inicioSeg * fps, (inicioSeg + duracaoSeg) * fps], [0, 1], LIMITE);
  const entrada = item.entrada.tipo === "gradual" ? interpolate(quadro, [0, quadros(item.entrada.duracaoSeg, fps)], [0, 1], LIMITE) : 1;
  const saida = item.saida.tipo === "fade" ? interpolate(quadro, [total - quadros(item.saida.duracaoSeg, fps), total], [1, 0], LIMITE) : 1;
  const titulo = surgir(0.05, 0.4), linha = surgir(0.3, 0.3), subtitulo = surgir(0.45, 0.35);
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <AbsoluteFill
        style={{
          opacity: Math.min(entrada, saida), backgroundColor: item.corDeFundo, color: item.corDoTexto, alignItems: "center", justifyContent: "center", textAlign: "center",
          fontFamily: familia(item.fonte), padding: "0 8%", gap: base * 0.035,
        }}
      >
        {logo ? (
          <div style={{ opacity: titulo, width: "60%", height: item.titulo ? base * 0.18 : base * 0.35 }}>
            {eVideo(logo) ? <OffthreadVideo src={staticFile(logo)} style={{ width: "100%", height: "100%", objectFit: "contain" }} transparent muted /> : <Img src={staticFile(logo)} style={{ width: "100%", height: "100%", objectFit: "contain" }} />}
          </div>
        ) : null}
        {item.titulo ? <div style={{ opacity: titulo, transform: `translateY(${(1 - titulo) * base * 0.05}px)`, fontSize: base * 0.085, fontWeight: 800, lineHeight: 1.1 }}>{item.titulo}</div> : null}
        {item.titulo || item.subtitulo ? <div style={{ width: base * 0.3, height: Math.max(2, base * 0.006), backgroundColor: item.corDoTexto, transform: `scaleX(${linha})` }} /> : null}
        {item.subtitulo ? <div style={{ opacity: subtitulo, transform: `translateY(${(1 - subtitulo) * base * 0.03}px)`, fontSize: base * 0.045, fontWeight: 600 }}>{item.subtitulo}</div> : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Texto: React.FC<{ item: ItemTexto; margens: AreaSegura }> = ({ item, margens }) => {
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
        alignItems: "center", padding: `${height * margens.topo}px ${margens.lados * 100}% ${height * margens.base}px`,
        justifyContent: item.posicao === "topo" ? "flex-start" : item.posicao === "base" ? "flex-end" : "center",
      }}
    >
      <div
        style={{
          opacity: presenca, transform: `translateY(${subida}px)`, color: item.cor, fontSize: height * item.tamanho, fontWeight: 800,
          fontFamily: familia(item.fonte), textAlign: "center", lineHeight: 1.15, textShadow: "0 2px 12px rgba(0,0,0,0.75)",
          backgroundColor: item.fundo || undefined, padding: item.fundo ? "0.3em 0.6em" : 0, borderRadius: "0.25em",
        }}
      >
        {item.texto}
      </div>
    </AbsoluteFill>
  );
};

const Legenda: React.FC<{ item: ItemLegenda; estilo: Timeline["legendas"]; margens: AreaSegura }> = ({ item, estilo, margens }) => {
  const { height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", padding: `0 ${margens.lados * 100}% ${height * margens.base}px` }}>
      <div
        style={{
          color: estilo.cor ?? "white", fontSize: height * estilo.tamanho, fontWeight: 700, fontFamily: familia(estilo.fonte), textAlign: "center", lineHeight: 1.25,
          backgroundColor: estilo.caixa ? (estilo.fundo ?? "rgba(0,0,0,0.65)") : undefined, padding: "0.25em 0.55em", borderRadius: "0.2em",
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
  const margens = timeline.areaSegura ?? MARGENS_PADRAO;
  const ordenados = [...timeline.itens].sort((a, b) => a.camada - b.camada || a.inicioSeg - b.inicioSeg);
  const barras = timeline.efeitosGlobais.find((e): e is Extract<Efeito, { tipo: "barras-de-cinema" }> => e.tipo === "barras-de-cinema");
  const sequencia = (item: ItemDaTimeline, conteudo: React.ReactNode) => (
    <Sequence key={item.id} from={Math.round(item.inicioSeg * fps)} durationInFrames={quadros(item.duracaoSeg, fps)}>
      {conteudo}
    </Sequence>
  );
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <FontesDaMarca timeline={timeline} arquivos={arquivos} />
      {ordenados.filter(eVisual).map((item) =>
        item.tipo === "imagem" && item.sobreposicao && arquivos[item.id] ? sequencia(item, <Sobreposicao item={item} arquivo={arquivos[item.id]} />)
          : arquivos[item.id] ? sequencia(item, <Visual item={item} arquivo={arquivos[item.id]} />)
          : item.tipo === "cartao" ? sequencia(item, <CartaoDesenhado item={item} logo={arquivos[`logo:${item.id}`]} />) : null,
      )}
      {barras ? <BarrasDeCinema proporcao={barras.proporcao} /> : null}
      {ordenados.map((item) =>
        item.tipo === "legenda"
          ? sequencia(item, <Legenda item={item} estilo={timeline.legendas} margens={margens} />)
          : item.tipo === "texto"
            ? sequencia(item, <Texto item={item} margens={margens} />)
            : null,
      )}
      {ordenados.map((item) => (item.tipo === "audio" && arquivos[item.id] ? sequencia(item, <Som item={item} arquivo={arquivos[item.id]} />) : null))}
    </AbsoluteFill>
  );
};
