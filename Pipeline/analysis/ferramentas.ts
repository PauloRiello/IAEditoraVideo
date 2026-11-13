// Execução do FFmpeg e do FFprobe e leitura dos dados técnicos de um arquivo.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { DadosTecnicos } from "../../src/dominio/analise.ts";

/** Executa um programa e devolve a saída padrão como bytes. Lança erro se o programa falhar. */
export function executar(comando: string, argumentos: string[], ambiente?: NodeJS.ProcessEnv): Promise<Buffer> {
  return new Promise((resolver, rejeitar) => {
    const processo = spawn(comando, argumentos, { stdio: ["ignore", "pipe", "pipe"], env: ambiente ?? process.env });
    const saida: Buffer[] = [];
    let erro = "";
    processo.stdout.on("data", (bloco: Buffer) => saida.push(bloco));
    processo.stderr.on("data", (bloco: Buffer) => (erro = (erro + bloco.toString()).slice(-2000)));
    processo.on("error", (falha) => rejeitar(new Error(`Não foi possível executar ${comando}: ${falha.message}`)));
    processo.on("close", (codigo) => {
      if (codigo === 0) resolver(Buffer.concat(saida));
      else rejeitar(new Error(`${path.basename(comando)} falhou (código ${codigo}): ${erro.trim().split("\n").slice(-2).join(" | ")}`));
    });
  });
}

// O programa instalado poderá apontar para executáveis próprios por estas variáveis.
export const ffmpeg = (argumentos: string[]) => executar(process.env.IAEV_FFMPEG ?? "ffmpeg", ["-v", "error", "-nostdin", ...argumentos]);
const ffprobe = (argumentos: string[]) => executar(process.env.IAEV_FFPROBE ?? "ffprobe", ["-v", "error", ...argumentos]);

function mdc(a: number, b: number): number {
  return b === 0 ? a : mdc(b, a % b);
}

/** Lê duração, resolução, taxa de quadros e codecs. */
export async function sondar(arquivo: string): Promise<DadosTecnicos> {
  const dados = JSON.parse((await ffprobe(["-show_format", "-show_streams", "-of", "json", arquivo])).toString()) as {
    format: { duration?: string; bit_rate?: string };
    streams: { codec_type: string; codec_name: string; width?: number; height?: number; avg_frame_rate?: string; duration?: string }[];
  };
  const video = dados.streams.find((s) => s.codec_type === "video");
  if (!video?.width || !video.height) throw new Error(`O arquivo não tem faixa de vídeo: ${arquivo}`);
  const audio = dados.streams.find((s) => s.codec_type === "audio");
  const [numerador, denominador] = (video.avg_frame_rate ?? "0/1").split("/").map(Number);
  const divisor = mdc(video.width, video.height);
  return {
    duracaoSeg: Number(dados.format.duration ?? video.duration ?? 0),
    largura: video.width,
    altura: video.height,
    fps: denominador ? Math.round((numerador / denominador) * 100) / 100 : 0,
    proporcao: `${video.width / divisor}:${video.height / divisor}`,
    orientacao: video.width === video.height ? "quadrado" : video.width > video.height ? "horizontal" : "vertical",
    codecVideo: video.codec_name,
    codecAudio: audio?.codec_name ?? null,
    taxaDeBitsKbps: dados.format.bit_rate ? Math.round(Number(dados.format.bit_rate) / 1000) : null,
    temAudio: Boolean(audio),
    faixasDeLegenda: dados.streams.filter((s) => s.codec_type === "subtitle").length,
  };
}

/** Extrai um quadro em JPEG para cada instante pedido. Devolve os caminhos dos arquivos. */
export async function extrairQuadros(arquivo: string, temposSeg: number[], pasta: string): Promise<string[]> {
  mkdirSync(pasta, { recursive: true });
  const arquivos: string[] = [];
  for (const [i, tempo] of temposSeg.entries()) {
    const destino = path.join(pasta, `quadro-${String(i + 1).padStart(2, "0")}.jpg`);
    await ffmpeg(["-y", "-ss", tempo.toFixed(2), "-i", arquivo, "-frames:v", "1", "-vf", "scale=512:-2", "-q:v", "4", destino]);
    arquivos.push(destino);
  }
  return arquivos;
}

export const arredondar = (n: number, casas = 2): number => Math.round(n * 10 ** casas) / 10 ** casas;

export function mediana(valores: number[]): number {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = ordenados.length >> 1;
  return ordenados.length % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
}
