// Render real com a marca: caixa da legenda na cor da marca, logo no canto, encerramento e GIF
// animado. As cores são conferidas num quadro extraído do vídeo final com o FFmpeg.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { renderizarTimeline } from "../../Pipeline/rendering/motor.ts";
import { aplicarMarca, type RetratoDaMarca } from "../../src/dominio/marca-na-timeline.ts";
import type { Timeline } from "../../src/dominio/timeline.ts";
import { normalizarTimeline } from "../../src/servicos/timeline.ts";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const pasta = mkdtempSync(path.join(os.tmpdir(), "iaev-render-marca-"));
after(() => rmSync(pasta, { recursive: true, force: true }));
const ff = (...args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
const LARGURA = 640, ALTURA = 360;

/** Fonte qualquer do sistema com licença livre, só para provar que o arquivo é carregado. */
const FONTE = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/crosextra/Caladea-Regular.ttf"].find((f) => existsSync(f));

function preparar() {
  mkdirSync(path.join(pasta, "midia"), { recursive: true });
  const video = path.join(pasta, "midia", "cinza.mp4");
  if (!existsSync(video)) ff("-f", "lavfi", "-i", `color=c=0x808080:s=${LARGURA}x${ALTURA}:d=2:r=30`, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", video);
  const logo = path.join(pasta, "midia", "logo.png");
  if (!existsSync(logo)) ff("-f", "lavfi", "-i", "color=c=red:s=200x80", "-frames:v", "1", logo);
  const gif = path.join(pasta, "midia", "logo.gif");
  if (!existsSync(gif)) ff("-f", "lavfi", "-i", "testsrc=s=200x80:d=1:r=10", gif);
  return { video, logo, gif };
}

function timelineCom(video: string): Timeline {
  const visual = { enquadramento: { modo: "preencher" as const, x: 0.5, y: 0.5, zoom: 1 }, entrada: { tipo: "corte" as const, duracaoSeg: 0 }, saida: { tipo: "corte" as const, duracaoSeg: 0 }, efeitos: [] };
  return normalizarTimeline({
    versao: 1, formato: { largura: LARGURA, altura: ALTURA, fps: 30 }, duracaoSeg: 2, efeitosGlobais: [], areaSegura: { topo: 0.05, base: 0.08, lados: 0.04 },
    legendas: { tamanho: 0.1, caixa: true },
    itens: [
      { id: "clipe", tipo: "video", camada: 0, inicioSeg: 0, duracaoSeg: 2, arquivo: video, inicioOrigemSeg: 0, velocidade: 1, volume: 1, ...visual },
      { id: "legenda", tipo: "legenda", camada: 10, inicioSeg: 0, duracaoSeg: 2, texto: "Olá, mundo da marca" },
    ],
  });
}

const retrato = (logo: string): RetratoDaMarca => ({
  id: "m1", atualizadaEm: "2026-11-18T10:00:00Z", logo, logoClaro: null, logoPosicao: { canto: "superior-direito", alturaRelativa: 0.15, opacidade: 1 },
  cores: [{ hex: "#1A2B3C", papel: "primaria", base: "observado", fonte: "teste" }, { hex: "#FFFFFF", papel: "texto", base: "observado", fonte: "teste" }],
  fontes: { titulos: null, texto: FONTE ? { nome: "Fonte da Marca", arquivos: [FONTE], origem: "enviada", licenca: "livre" } : null },
});

async function renderizar(timeline: Timeline, nome: string): Promise<string> {
  const destino = path.join(pasta, `${nome}.mp4`);
  await renderizarTimeline({
    id: nome, timeline, destino, qualidade: "final", pastaDeCache: path.join(pasta, "cache"), pastaTemporaria: path.join(RAIZ, "Dados", "temp"),
    concorrencia: 2, codificarPorHardware: false, cancelamento: { cancelado: false },
  });
  return destino;
}

/** Pixels RGB de um quadro (no tamanho do vídeo). */
function quadro(arquivo: string, segundos: number): Buffer {
  return execFileSync("ffmpeg", ["-v", "error", "-ss", String(segundos), "-i", arquivo, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 64 * 1024 * 1024 });
}
function contar(pixels: Buffer, regiao: { x0: number; y0: number; x1: number; y1: number }, cor: [number, number, number], tolerancia = 14): number {
  let n = 0;
  for (let y = Math.floor(regiao.y0 * ALTURA); y < Math.floor(regiao.y1 * ALTURA); y++) for (let x = Math.floor(regiao.x0 * LARGURA); x < Math.floor(regiao.x1 * LARGURA); x++) {
    const i = (y * LARGURA + x) * 3;
    if (Math.abs(pixels[i] - cor[0]) <= tolerancia && Math.abs(pixels[i + 1] - cor[1]) <= tolerancia && Math.abs(pixels[i + 2] - cor[2]) <= tolerancia) n++;
  }
  return n;
}

test("render com marca: caixa da legenda na cor da marca, logo no canto e encerramento", { timeout: 300_000 }, async () => {
  const { video, logo } = preparar();
  const { timeline } = aplicarMarca(timelineCom(video), retrato(logo));
  const arquivo = await renderizar(normalizarTimeline(timeline), "com-marca");
  const meio = quadro(arquivo, 1);
  // Caixa da legenda: #1A2B3C com alfa 0,85 sobre o cinza #808080 ≈ (41, 56, 70).
  assert.ok(contar(meio, { x0: 0, y0: 0.6, x1: 1, y1: 1 }, [41, 56, 70]) > 400, "caixa da legenda na cor da marca");
  assert.equal(contar(meio, { x0: 0, y0: 0.6, x1: 1, y1: 1 }, [45, 45, 45], 6), 0, "nada da caixa preta padrão");
  // Logo vermelho no canto superior direito.
  assert.ok(contar(meio, { x0: 0.6, y0: 0, x1: 1, y1: 0.3 }, [255, 0, 0], 30) > 300, "logo no canto superior direito");
  assert.equal(contar(meio, { x0: 0, y0: 0, x1: 0.4, y1: 0.3 }, [255, 0, 0], 30), 0, "e não no esquerdo");
  // Encerramento: fundo na cor primária e o logo no centro.
  const fim = quadro(arquivo, 2.9);
  assert.ok(contar(fim, { x0: 0, y0: 0, x1: 1, y1: 1 }, [0x1a, 0x2b, 0x3c], 10) > LARGURA * ALTURA * 0.5, "encerramento na cor da marca");
  assert.ok(contar(fim, { x0: 0.3, y0: 0.3, x1: 0.7, y1: 0.7 }, [255, 0, 0], 30) > 300, "logo no centro do encerramento");
});

test("GIF animado vira trecho com transparência e não quebra o render", { timeout: 300_000 }, async () => {
  const { video, gif } = preparar();
  const { timeline } = aplicarMarca(timelineCom(video), retrato(gif));
  const arquivo = await renderizar(normalizarTimeline(timeline), "com-gif");
  assert.ok(existsSync(arquivo));
  assert.ok(readdirSync(path.join(pasta, "cache")).some((a) => a.endsWith(".webm")), "o GIF foi convertido em trecho .webm");
  const meio = quadro(arquivo, 1);
  // Algo diferente do cinza no canto do logo (o padrão de teste é colorido).
  assert.ok(contar(meio, { x0: 0.6, y0: 0, x1: 1, y1: 0.3 }, [128, 128, 128], 6) < (0.4 * LARGURA) * (0.3 * ALTURA) * 0.9);
});
