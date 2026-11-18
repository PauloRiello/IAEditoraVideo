// Motor de render. Papéis de cada ferramenta:
//   FFmpeg      prepara os trechos usados (recorte exato, taxa de quadros constante, escala), sem tocar nos originais;
//   HyperFrames gera cartões animados em HTML/GSAP, que entram como trechos;
//   Remotion    compõe a timeline inteira e codifica o MP4 (H.264 + AAC).
// Há um único motor de composição: o Remotion. Os outros dois só produzem insumos para ele.

import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, makeCancelSignal, renderMedia, selectComposition } from "@remotion/renderer";
import type { ItemAudio, ItemCartao, ItemImagem, ItemVideo, Timeline } from "../../src/dominio/timeline.ts";
import { executarDetalhado, sondar } from "../analysis/ferramentas.ts";
import { renderizarCartao } from "./hyperframes.ts";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PROGRAMA = path.resolve(AQUI, "..", "..");
const FONTES_DA_COMPOSICAO = ["index.ts", "Raiz.tsx", "Video.tsx"].map((nome) => path.join(AQUI, "remotion", nome));

export class RenderCancelado extends Error {
  constructor() {
    super("Renderização cancelada.");
    this.name = "RenderCancelado";
  }
}

export interface Cancelamento {
  cancelado: boolean;
  /** Preenchido pelo motor enquanto há algo em andamento que possa ser interrompido. */
  interromper?: () => void;
}

export interface PedidoDeRender {
  id: string;
  timeline: Timeline;
  /** Arquivo final. Só passa a existir quando o render termina com sucesso. */
  destino: string;
  qualidade: "previa" | "final";
  /** Trechos preparados, reaproveitados entre prévias e renders. */
  pastaDeCache: string;
  pastaTemporaria: string;
  /** Quantos quadros são desenhados em paralelo. */
  concorrencia: number;
  /** Tenta codificar pela GPU (NVENC ou VideoToolbox); se não der, o Remotion usa a CPU. */
  codificarPorHardware: boolean;
  cancelamento: Cancelamento;
  aoProgredir?: (fase: "preparando" | "renderizando", fracao: number) => void;
  /** Ajustes de um preset de exportação. Sem eles, valem os padrões da qualidade escolhida. */
  ajustes?: { escala: number; crf: number; velocidadeDeCodificacao: "veryfast" | "medium" | "slow"; taxaDeBitsDoAudioKbps: number };
}

/** Move um arquivo. Entre discos diferentes (por exemplo, dados em C: e exportações em D:), copia e apaga a origem. */
export function moverArquivo(origem: string, destino: string): void {
  mkdirSync(path.dirname(destino), { recursive: true });
  try {
    renameSync(origem, destino);
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code !== "EXDEV") throw erro;
    copyFileSync(origem, destino);
    rmSync(origem, { force: true });
  }
}

const par = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Na prévia a imagem sai com um terço do tamanho (ou metade, se um terço não der dimensões pares). */
export function escalaDaQualidade(timeline: Timeline, qualidade: "previa" | "final"): number {
  if (qualidade === "final") return 1;
  const { largura, altura } = timeline.formato;
  return [1 / 3, 1 / 2, 1 / 4].find((e) => Number.isInteger(largura * e) && Number.isInteger(altura * e) && (largura * e) % 2 === 0 && (altura * e) % 2 === 0) ?? 1;
}

async function ffmpeg(argumentos: string[]): Promise<void> {
  const r = await executarDetalhado(process.env.IAEV_FFMPEG ?? "ffmpeg", ["-v", "error", "-nostdin", "-y", ...argumentos]);
  if (r.codigo !== 0) throw new Error(`FFmpeg falhou ao preparar um trecho: ${r.erro.split("\n").slice(-2).join(" | ").replace(/ @ 0x[0-9a-f]+/gi, "").slice(0, 300)}`);
}

/** Nome de cache: muda se o arquivo original, o trecho ou a qualidade mudarem. */
function chave(arquivo: string | null, ...partes: unknown[]): string {
  const original = arquivo ? [arquivo, statSync(arquivo).size, statSync(arquivo).mtimeMs] : [];
  return createHash("sha1").update(JSON.stringify([...original, ...partes])).digest("hex").slice(0, 16);
}

/**
 * Prepara os trechos de mídia de cada item e devolve, por item, o arquivo preparado.
 * Os originais são apenas lidos. Um trecho já preparado é reaproveitado.
 */
async function prepararMidias(p: PedidoDeRender, escala: number): Promise<Record<string, string>> {
  mkdirSync(p.pastaDeCache, { recursive: true });
  const { formato } = p.timeline;
  const alvo = { largura: formato.largura * escala, altura: formato.altura * escala };
  const final = p.qualidade === "final";
  const comMidia = p.timeline.itens.filter((i): i is ItemVideo | ItemImagem | ItemCartao | ItemAudio => i.tipo !== "texto" && i.tipo !== "legenda");
  const preparados: Record<string, string> = {};

  for (const [n, item] of comMidia.entries()) {
    if (p.cancelamento.cancelado) throw new RenderCancelado();
    p.aoProgredir?.("preparando", n / comMidia.length);
    let destino: string;

    if (item.tipo === "video") {
      const origem = await sondar(item.arquivo);
      // Reduz só até o tamanho necessário para cobrir (ou caber em) o quadro; nunca amplia.
      const zoom = item.enquadramento.zoom * (item.efeitos.some((e) => e.tipo === "zoom-lento") ? 1.15 : 1);
      const razoes = [alvo.largura / origem.largura, alvo.altura / origem.altura];
      const fator = (item.enquadramento.modo === "preencher" ? Math.max(...razoes) : Math.min(...razoes)) * zoom;
      const tamanho = fator < 1 ? `${par(origem.largura * fator)}:${par(origem.altura * fator)}` : null;
      const duracaoDaOrigem = item.duracaoSeg * item.velocidade;
      destino = path.join(p.pastaDeCache, `${chave(item.arquivo, item.inicioOrigemSeg, duracaoDaOrigem, tamanho, final)}.mp4`);
      if (!existsSync(destino)) {
        const parcial = `${destino}.parcial.mp4`;
        await ffmpeg([
          "-ss", String(item.inicioOrigemSeg), "-t", String(duracaoDaOrigem + 0.1), "-i", item.arquivo,
          ...(tamanho ? ["-vf", `scale=${tamanho}`] : []),
          // Taxa de quadros constante, igual à do original: sem conversão de taxa nesta etapa.
          "-fps_mode", "cfr", "-c:v", "libx264", "-preset", final ? "veryfast" : "ultrafast", "-crf", final ? "15" : "30", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-movflags", "+faststart", parcial,
        ]);
        renameSync(parcial, destino);
      }
    } else if (item.tipo === "audio") {
      destino = path.join(p.pastaDeCache, `${chave(item.arquivo, item.inicioOrigemSeg, item.duracaoSeg)}.m4a`);
      if (!existsSync(destino)) {
        const parcial = `${destino}.parcial.m4a`;
        await ffmpeg(["-ss", String(item.inicioOrigemSeg), "-t", String(item.duracaoSeg + 0.1), "-i", item.arquivo, "-vn", "-c:a", "aac", "-b:a", "192k", "-ac", "2", parcial]);
        renameSync(parcial, destino);
      }
    } else if (item.tipo === "imagem") {
      destino = path.join(p.pastaDeCache, `${chave(item.arquivo)}${path.extname(item.arquivo).toLowerCase()}`);
      if (!existsSync(destino)) copyFileSync(item.arquivo, destino);
    } else {
      const tamanho = { largura: par(alvo.largura), altura: par(alvo.altura), fps: formato.fps };
      destino = path.join(p.pastaDeCache, `${chave(null, "cartao", item.titulo, item.subtitulo, item.corDeFundo, item.corDoTexto, item.duracaoSeg, tamanho)}.mp4`);
      if (!existsSync(destino)) {
        try {
          await renderizarCartao(item, tamanho, destino, PROGRAMA);
        } catch (erro) {
          // Sem HyperFrames utilizável neste computador, o cartão não vira trecho: a composição o desenha.
          console.error(`${new Date().toISOString()} Cartão "${item.titulo}" desenhado pela composição: ${erro instanceof Error ? erro.message : String(erro)}`);
          continue;
        }
      }
    }
    preparados[item.id] = destino;
  }
  return preparados;
}

let empacotando: Promise<string> | null = null;

/** Uma porta livre neste computador, para o servidor interno do render. */
function portaLivre(): Promise<number> {
  return new Promise((resolver, rejeitar) => {
    const sonda = createServer();
    sonda.once("error", rejeitar);
    sonda.listen(0, () => {
      const { port } = sonda.address() as { port: number };
      sonda.close(() => resolver(port));
    });
  });
}

/** Empacota a composição do Remotion uma vez e reaproveita o pacote enquanto o código não mudar. */
function pacoteDaComposicao(pastaTemporaria: string): Promise<string> {
  empacotando ??= (async () => {
    const pasta = path.join(pastaTemporaria, "remotion-pacote");
    const assinatura = createHash("sha1").update(FONTES_DA_COMPOSICAO.map((arquivo) => readFileSync(arquivo, "utf8")).join("\n")).digest("hex");
    const marca = path.join(pasta, "assinatura.txt");
    if (existsSync(marca) && readFileSync(marca, "utf8") === assinatura && existsSync(path.join(pasta, "index.html"))) return pasta;
    rmSync(pasta, { recursive: true, force: true });
    await bundle({ entryPoint: FONTES_DA_COMPOSICAO[0], outDir: pasta, publicDir: null });
    writeFileSync(marca, assinatura);
    return pasta;
  })().catch((erro) => {
    empacotando = null;
    throw erro;
  });
  return empacotando;
}

/** Chrome do sistema, usado se o navegador próprio do Remotion não puder ser baixado. */
function chromeDoSistema(): string | undefined {
  const candidatos = [
    process.env.IAEV_CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  return candidatos.find((caminho): caminho is string => Boolean(caminho) && existsSync(caminho as string));
}

/** Renderiza a timeline no arquivo de destino. Em caso de erro ou cancelamento, nenhum arquivo parcial fica no destino. */
export async function renderizarTimeline(p: PedidoDeRender): Promise<{ largura: number; altura: number }> {
  const escala = p.ajustes?.escala ?? escalaDaQualidade(p.timeline, p.qualidade);
  const parcial = path.join(p.pastaTemporaria, `render-${p.id}.mp4`);
  let pastaPublica = "";
  try {
    const preparados = await prepararMidias(p, escala);
    if (p.cancelamento.cancelado) throw new RenderCancelado();
    const pacote = await pacoteDaComposicao(p.pastaTemporaria);

    // Os trechos preparados são expostos à composição numa pasta pública própria deste render.
    // O nome inclui o processo: duas instâncias que compartilhem a pasta temporária não se atrapalham.
    const nomeDaPasta = `${p.id}-${process.pid}`;
    pastaPublica = path.join(pacote, "public", nomeDaPasta);
    mkdirSync(pastaPublica, { recursive: true });
    const arquivos: Record<string, string> = {};
    for (const [itemId, arquivo] of Object.entries(preparados)) {
      copyFileSync(arquivo, path.join(pastaPublica, path.basename(arquivo)));
      arquivos[itemId] = `${nomeDaPasta}/${path.basename(arquivo)}`;
    }

    let navegador: string | undefined;
    try {
      await ensureBrowser({ logLevel: "error" });
    } catch {
      navegador = chromeDoSistema();
      if (!navegador) throw new Error("Nenhum navegador disponível para renderizar: o navegador de render não pôde ser baixado. Confira a internet e tente de novo.");
    }

    const { cancel, cancelSignal } = makeCancelSignal();
    p.cancelamento.interromper = cancel;
    if (p.cancelamento.cancelado) throw new RenderCancelado();
    const inputProps = { timeline: p.timeline, arquivos };
    const comum = { serveUrl: pacote, inputProps, browserExecutable: navegador, logLevel: "error" as const };
    // Cada etapa usa uma porta livre própria: a porta padrão do Remotion é fixa e pode estar em uso por outro programa ou outro render.
    const composition = await selectComposition({ ...comum, id: "Timeline", port: await portaLivre() });
    const final = p.qualidade === "final";
    await renderMedia({
      ...comum,
      port: await portaLivre(),
      composition,
      codec: "h264",
      audioCodec: "aac",
      outputLocation: parcial,
      overwrite: true,
      scale: escala,
      concurrency: p.concorrencia,
      imageFormat: "jpeg",
      jpegQuality: final ? 90 : 60,
      x264Preset: p.ajustes?.velocidadeDeCodificacao ?? (final ? "medium" : "veryfast"),
      audioBitrate: `${p.ajustes?.taxaDeBitsDoAudioKbps ?? 192}k`,
      // A codificação por hardware não aceita CRF: usa taxa de bits. Sem hardware, CRF.
      ...(p.codificarPorHardware && final ? { hardwareAcceleration: "if-possible" as const, videoBitrate: "10M" } : { crf: p.ajustes?.crf ?? (final ? 18 : 30) }),
      cancelSignal,
      onProgress: ({ progress }) => p.aoProgredir?.("renderizando", progress),
    });
    moverArquivo(parcial, p.destino);
    return { largura: par(p.timeline.formato.largura * escala), altura: par(p.timeline.formato.altura * escala) };
  } catch (erro) {
    if (p.cancelamento.cancelado) throw new RenderCancelado();
    throw erro;
  } finally {
    p.cancelamento.interromper = undefined;
    rmSync(parcial, { force: true });
    if (pastaPublica) rmSync(pastaPublica, { recursive: true, force: true });
  }
}
