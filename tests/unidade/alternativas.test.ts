// Testes dos caminhos alternativos: o que a aplicação faz quando uma ferramenta opcional
// não funciona no computador do usuário (placa de vídeo sem bibliotecas, navegador do
// HyperFrames que não abre). Nenhuma dessas falhas pode impedir o trabalho.
// Executar: npm test

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { renderizarCartao } from "../../Pipeline/rendering/hyperframes.ts";
import { renderizarTimeline } from "../../Pipeline/rendering/motor.ts";
import { pythonDoPrograma, transcrever } from "../../Pipeline/transcription/whisper.ts";
import type { ItemCartao, Timeline } from "../../src/dominio/timeline.ts";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const base = mkdtempSync(path.join(os.tmpdir(), "iaev-alternativas-"));
const ambienteOriginal = { navegador: process.env.HYPERFRAMES_BROWSER_PATH, semHyperframes: process.env.IAEV_SEM_HYPERFRAMES };

after(() => {
  for (const [nome, valor] of [["HYPERFRAMES_BROWSER_PATH", ambienteOriginal.navegador], ["IAEV_SEM_HYPERFRAMES", ambienteOriginal.semHyperframes]] as const) {
    if (valor === undefined) delete process.env[nome];
    else process.env[nome] = valor;
  }
  if (process.env.IAEV_GUARDAR_QUADROS) {
    for (const nome of ["cartao-hyperframes", "final"]) {
      if (existsSync(path.join(base, `${nome}.mp4`))) execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", "1.2", "-i", path.join(base, `${nome}.mp4`), "-frames:v", "1", path.join(process.env.IAEV_GUARDAR_QUADROS, `${nome}.png`)]);
    }
  }
  rmSync(base, { recursive: true, force: true });
});

const cartao: ItemCartao = {
  id: "cartao-final", tipo: "cartao", camada: 0, inicioSeg: 0, duracaoSeg: 1.5, titulo: "Cidade Alta", subtitulo: "Entre no Discord", corDeFundo: "#123a8c", corDoTexto: "#ffffff",
  enquadramento: { modo: "preencher", x: 0.5, y: 0.5, zoom: 1 }, entrada: { tipo: "corte", duracaoSeg: 0 }, saida: { tipo: "corte", duracaoSeg: 0 }, efeitos: [],
};
const sondar = (arquivo: string) =>
  (JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", arquivo]).toString()) as { streams: { codec_name: string; width?: number; height?: number }[] }).streams.find((s) => s.width)!;
/** Cor média (R, G, B) e variação de claridade de um quadro, medidas pelo FFmpeg. */
const quadro = (arquivo: string, segundo: number) => {
  const bruto = execFileSync("ffmpeg", ["-v", "error", "-ss", String(segundo), "-i", arquivo, "-frames:v", "1", "-vf", "scale=90:160", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]);
  const pontos = bruto.length / 3;
  const media = [0, 1, 2].map((canal) => Math.round(bruto.filter((_, i) => i % 3 === canal).reduce((soma, v) => soma + v, 0) / pontos));
  // Pontos claros: o texto branco sobre o fundo colorido.
  const claros = [...Array(pontos).keys()].filter((px) => bruto[px * 3] > 170 && bruto[px * 3 + 1] > 170 && bruto[px * 3 + 2] > 170).length;
  return { media, claros };
};

test("Whisper: se a placa de vídeo não puder ser usada, a transcrição é feita pelo processador", async () => {
  const python = pythonDoPrograma(RAIZ);
  assert.ok(python, "o ambiente Python do programa existe");
  const audio = path.join(base, "tom.wav");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=440:d=2", "-ar", "16000", "-ac", "1", audio]);
  process.env.HF_HUB_DISABLE_XET ??= "1";
  // Pede a placa de vídeo. Onde ela não existe ou está sem as bibliotecas, o resultado vem mesmo assim, com o aviso.
  const resultado = await transcrever(audio, { python: python as string, modelo: "tiny", dispositivo: "cuda", idioma: "", pastaDeModelos: path.join(RAIZ, "Dados", "modelos", "whisper") });
  assert.ok(Array.isArray(resultado.segmentos));
  if (resultado.aviso !== undefined) assert.match(resultado.aviso, /placa de vídeo não pôde ser usada.*feita pelo processador/);
});

test("HyperFrames: se o navegador próprio dele não abrir, o cartão é renderizado com outro navegador", async () => {
  // Simula o navegador do HyperFrames inutilizável neste computador.
  process.env.HYPERFRAMES_BROWSER_PATH = path.join(base, "navegador-que-nao-existe");
  const destino = path.join(base, "cartao-hyperframes.mp4");
  await renderizarCartao(cartao, { largura: 360, altura: 640, fps: 30 }, destino, RAIZ);
  const video = sondar(destino);
  assert.deepEqual([video.codec_name, video.width, video.height], ["h264", 360, 640]);
  const meio = quadro(destino, 1.2);
  assert.ok(meio.media[2] > meio.media[0] + 40, `fundo azul do cartão: ${meio.media}`);
  assert.ok(meio.claros > 40, "título e subtítulo em branco aparecem");
  delete process.env.HYPERFRAMES_BROWSER_PATH;
});

test("sem HyperFrames utilizável, o cartão é desenhado pela própria composição e o render não falha", async () => {
  process.env.IAEV_SEM_HYPERFRAMES = "1";
  await assert.rejects(renderizarCartao(cartao, { largura: 360, altura: 640, fps: 30 }, path.join(base, "nao-sai.mp4"), RAIZ), /HyperFrames/);

  const timeline: Timeline = { versao: 1, formato: { largura: 360, altura: 640, fps: 30 }, duracaoSeg: 1.5, itens: [cartao], efeitosGlobais: [], legendas: { tamanho: 0.035, caixa: true } };
  const destino = path.join(base, "final.mp4");
  const tamanho = await renderizarTimeline({
    id: "alternativa", timeline, destino, qualidade: "final", pastaDeCache: path.join(base, "cache"), pastaTemporaria: path.join(RAIZ, "Dados", "temp"),
    concorrencia: 1, codificarPorHardware: false, cancelamento: { cancelado: false },
  });
  delete process.env.IAEV_SEM_HYPERFRAMES;
  assert.deepEqual(tamanho, { largura: 360, altura: 640 });
  assert.ok(existsSync(destino));
  const video = sondar(destino);
  assert.deepEqual([video.codec_name, video.width, video.height], ["h264", 360, 640]);

  // Mesmo conteúdo do cartão do HyperFrames: fundo na cor pedida e textos brancos depois da entrada.
  const desenhado = quadro(destino, 1.2), referencia = quadro(path.join(base, "cartao-hyperframes.mp4"), 1.2);
  assert.ok(desenhado.media[2] > desenhado.media[0] + 40, `fundo azul do cartão: ${desenhado.media}`);
  assert.ok(desenhado.claros > 40, "título e subtítulo em branco aparecem");
  for (const canal of [0, 1, 2]) assert.ok(Math.abs(desenhado.media[canal] - referencia.media[canal]) < 25, `cor média parecida com a do cartão do HyperFrames: ${desenhado.media} x ${referencia.media}`);
  assert.ok(Math.abs(desenhado.claros - referencia.claros) < referencia.claros * 0.5, `quantidade de texto parecida: ${desenhado.claros} x ${referencia.claros}`);
  assert.equal(quadro(destino, 0).claros, 0, "no primeiro quadro os textos ainda não entraram");
});
