// Execução do FFmpeg e do FFprobe e leitura dos dados técnicos de um arquivo.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { DadosTecnicos } from "../../src/dominio/analise.ts";

/** Executa um programa e devolve código de saída, saída padrão e mensagens de erro, sem lançar exceção. */
export function executarDetalhado(comando: string, argumentos: string[], ambiente?: NodeJS.ProcessEnv): Promise<{ codigo: number; saida: Buffer; erro: string }> {
  return new Promise((resolver) => {
    const processo = spawn(comando, argumentos, { stdio: ["ignore", "pipe", "pipe"], env: ambiente ?? process.env });
    const saida: Buffer[] = [];
    let erro = "";
    processo.stdout.on("data", (bloco: Buffer) => saida.push(bloco));
    processo.stderr.on("data", (bloco: Buffer) => (erro = (erro + bloco.toString()).slice(-2000)));
    processo.on("error", (falha) => resolver({ codigo: -1, saida: Buffer.alloc(0), erro: `Não foi possível executar ${comando}: ${falha.message}` }));
    processo.on("close", (codigo) => resolver({ codigo: codigo ?? -1, saida: Buffer.concat(saida), erro: erro.trim() }));
  });
}

/** Executa um programa e devolve a saída padrão como bytes. Lança erro se o programa falhar. */
export async function executar(comando: string, argumentos: string[]): Promise<Buffer> {
  const r = await executarDetalhado(comando, argumentos);
  if (r.codigo !== 0) throw new Error(`${path.basename(comando)} falhou (código ${r.codigo}): ${r.erro.split("\n").slice(-2).join(" | ")}`);
  return r.saida;
}

/** Decodifica um arquivo (inteiro ou um trecho) e devolve as mensagens de erro do FFmpeg. Vazio = sem erros. */
export async function errosDeDecodificacao(arquivo: string, trecho?: { inicioSeg: number; duracaoSeg: number }): Promise<string> {
  const corte = trecho ? ["-ss", String(trecho.inicioSeg), "-t", String(trecho.duracaoSeg)] : [];
  const r = await executarDetalhado(process.env.IAEV_FFMPEG ?? "ffmpeg", ["-v", "error", "-nostdin", ...corte, "-i", arquivo, "-f", "null", "-"]);
  return r.erro;
}

// O programa instalado poderá apontar para executáveis próprios por estas variáveis.
export const ffmpeg = (argumentos: string[]) => executar(process.env.IAEV_FFMPEG ?? "ffmpeg", ["-v", "error", "-nostdin", ...argumentos]);
const ffprobe = (argumentos: string[]) => executar(process.env.IAEV_FFPROBE ?? "ffprobe", ["-v", "error", ...argumentos]);

function mdc(a: number, b: number): number {
  return b === 0 ? a : mdc(b, a % b);
}

export interface Sonda {
  tecnico: DadosTecnicos;
  formato: string;
  audio: { codec: string; canais: number; taxaHz: number } | null;
  /** A taxa de quadros varia ao longo do arquivo (comum em gravações de tela e de celular). */
  taxaDeQuadrosVariavel: boolean;
}

/** Lê duração, resolução, taxa de quadros e codecs. */
export async function sondar(arquivo: string): Promise<DadosTecnicos> {
  return (await sondarCompleto(arquivo)).tecnico;
}

export async function sondarCompleto(arquivo: string): Promise<Sonda> {
  const dados = JSON.parse((await ffprobe(["-show_format", "-show_streams", "-of", "json", arquivo])).toString()) as {
    format: { duration?: string; bit_rate?: string; format_name?: string };
    streams: {
      codec_type: string; codec_name: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string;
      duration?: string; channels?: number; sample_rate?: string;
    }[];
  };
  const video = dados.streams.find((s) => s.codec_type === "video");
  if (!video?.width || !video.height) throw new Error(`O arquivo não tem faixa de vídeo: ${arquivo}`);
  const audio = dados.streams.find((s) => s.codec_type === "audio");
  const [numerador, denominador] = (video.avg_frame_rate ?? "0/1").split("/").map(Number);
  const divisor = mdc(video.width, video.height);
  const taxa = (texto?: string) => {
    const [a, b] = (texto ?? "0/1").split("/").map(Number);
    return b ? a / b : 0;
  };
  const media = taxa(video.avg_frame_rate), nominal = taxa(video.r_frame_rate);
  const extensao = path.extname(arquivo).slice(1).toLowerCase();
  const nomes = (dados.format.format_name ?? "").split(",");
  const tecnico: DadosTecnicos = {
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
  return {
    tecnico,
    formato: nomes.includes(extensao) ? extensao : (nomes[0] ?? extensao),
    audio: audio ? { codec: audio.codec_name, canais: audio.channels ?? 0, taxaHz: Number(audio.sample_rate ?? 0) } : null,
    taxaDeQuadrosVariavel: media > 0 && nominal > 0 && Math.abs(media - nominal) / nominal > 0.02,
  };
}

/** Extrai um quadro em JPEG para cada instante pedido. Devolve os caminhos dos arquivos. */
export async function extrairQuadros(arquivo: string, temposSeg: number[], pasta: string, largura = 512): Promise<string[]> {
  mkdirSync(pasta, { recursive: true });
  const arquivos: string[] = [];
  for (const [i, tempo] of temposSeg.entries()) {
    const destino = path.join(pasta, `quadro-${String(i + 1).padStart(2, "0")}.jpg`);
    await ffmpeg(["-y", "-ss", tempo.toFixed(2), "-i", arquivo, "-frames:v", "1", "-vf", `scale=${largura}:-2`, "-q:v", "4", destino]);
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
