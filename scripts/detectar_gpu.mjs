// Detecta a GPU e decide a aceleração de cada ferramenta.
// Grava config/local.aceleracao.json (arquivo por máquina, fora do Git).
// Uso: npm run gpu

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ARQUIVO_ACELERACAO, WINDOWS, binVenv, comPastaTemporaria, executar, existeComando } from "./lib/comum.mjs";

function detectarNvidia() {
  if (!existeComando("nvidia-smi")) return null;
  const r = executar("nvidia-smi", [
    "--query-gpu=name,memory.total,driver_version",
    "--format=csv,noheader,nounits",
  ]);
  if (!r.ok || !r.saida) return null;
  const [nome, vram, driver] = r.saida.split(/\r?\n/)[0].split(",").map((campo) => campo.trim());
  return { fabricante: "nvidia", nome, vramMB: Number(vram) || null, driver };
}

function detectarOutraGpu() {
  if (process.platform === "darwin") {
    const r = executar("system_profiler", ["SPDisplaysDataType", "-json"]);
    if (r.ok) {
      const placa = JSON.parse(r.saida).SPDisplaysDataType?.[0];
      if (placa) {
        const nome = placa.sppci_model ?? placa._name ?? "GPU Apple";
        return { fabricante: /apple/i.test(nome) ? "apple" : "outro", nome, vramMB: null, driver: null };
      }
    }
    return null;
  }
  let nomes = [];
  if (WINDOWS) {
    const r = executar("powershell", [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }",
    ]);
    if (r.ok) nomes = r.saida.split(/\r?\n/);
  } else if (existeComando("lspci")) {
    const r = executar("lspci");
    if (r.ok) nomes = r.saida.split(/\r?\n/).filter((linha) => /VGA|3D|Display/i.test(linha));
  }
  const nome = nomes.map((linha) => linha.trim()).find((linha) => /nvidia|amd|radeon|intel|arc/i.test(linha));
  if (!nome) return null;
  const fabricante = /nvidia/i.test(nome) ? "nvidia" : /amd|radeon/i.test(nome) ? "amd" : "intel";
  return { fabricante, nome, vramMB: null, driver: null };
}

// Um encoder listado pelo FFmpeg pode não funcionar (falta de GPU ou de driver).
// Por isso cada candidato é testado com uma codificação real de 1 segundo.
function testarEncoders(pasta) {
  const lista = executar("ffmpeg", ["-hide_banner", "-encoders"]);
  if (!lista.ok) return { disponivel: false, testados: {} };

  const candidatos = [
    { nome: "h264_nvenc", extras: [] },
    { nome: "h264_videotoolbox", extras: [] },
    { nome: "h264_qsv", extras: [] },
    { nome: "h264_amf", extras: [] },
  ];
  if (existsSync("/dev/dri/renderD128")) {
    candidatos.push({
      nome: "h264_vaapi",
      extras: ["-vaapi_device", "/dev/dri/renderD128", "-vf", "format=nv12,hwupload"],
    });
  }

  const testados = {};
  for (const { nome, extras } of candidatos) {
    if (!new RegExp(`\\s${nome}\\s`).test(lista.saida)) continue;
    const r = executar("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=duration=1:size=640x360:rate=30",
      ...extras,
      "-c:v", nome,
      path.join(pasta, `${nome}.mp4`),
    ]);
    testados[nome] = r.ok;
  }
  return { disponivel: true, testados };
}

function cudaNoWhisper() {
  const python = binVenv("python");
  if (!existsSync(python)) return { instalado: false, dispositivosCuda: 0 };
  const r = executar(python, ["-c", "import ctranslate2; print(ctranslate2.get_cuda_device_count())"]);
  return { instalado: r.ok, dispositivosCuda: r.ok ? Number(r.saida) || 0 : 0 };
}

export async function detectar() {
  const gpu = detectarNvidia() ?? detectarOutraGpu();
  const encoders = await comPastaTemporaria((pasta) => testarEncoders(pasta));
  const funcionais = Object.keys(encoders.testados).filter((nome) => encoders.testados[nome]);
  const encoderH264 = funcionais[0] ?? "libx264";
  const whisper = cudaNoWhisper();
  const usaCuda = whisper.dispositivosCuda > 0;

  // Remotion: aceleração de codificação existe só para VideoToolbox (macOS) e NVENC (Linux/Windows).
  const remotionAcelera = funcionais.includes("h264_videotoolbox") || funcionais.includes("h264_nvenc");

  return {
    detectadoEm: new Date().toISOString(),
    plataforma: `${process.platform}-${process.arch}`,
    gpu,
    ffmpeg: {
      encoderH264,
      aceleradoPorHardware: encoderH264 !== "libx264",
      encodersTestados: encoders.testados,
    },
    whisper: {
      device: usaCuda ? "cuda" : "cpu",
      computeType: usaCuda ? "float16" : "int8",
      bibliotecasCudaPendentes: gpu?.fabricante === "nvidia" && whisper.instalado && !usaCuda,
    },
    remotion: {
      hardwareAcceleration: remotionAcelera ? "if-possible" : "disable",
      gl: null,
    },
    hyperframes: {
      gpuEncoding: funcionais.length > 0,
    },
  };
}

export function gravar(aceleracao) {
  mkdirSync(path.dirname(ARQUIVO_ACELERACAO), { recursive: true });
  writeFileSync(ARQUIVO_ACELERACAO, `${JSON.stringify(aceleracao, null, 2)}\n`);
}

export function descrever(a) {
  return [
    `GPU: ${a.gpu ? `${a.gpu.nome} (${a.gpu.fabricante}${a.gpu.vramMB ? `, ${a.gpu.vramMB} MB` : ""})` : "nenhuma detectada"}`,
    `FFmpeg: encoder H.264 = ${a.ffmpeg.encoderH264}${a.ffmpeg.aceleradoPorHardware ? " (hardware)" : " (CPU)"}`,
    `Whisper: device = ${a.whisper.device}, compute_type = ${a.whisper.computeType}`,
    `Remotion: hardwareAcceleration = ${a.remotion.hardwareAcceleration}`,
    `HyperFrames: --gpu ${a.hyperframes.gpuEncoding ? "ativado" : "desativado"}`,
  ];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const aceleracao = await detectar();
  gravar(aceleracao);
  console.log("\n== Aceleração detectada ==");
  for (const linha of descrever(aceleracao)) console.log(`  ${linha}`);
  if (aceleracao.whisper.bibliotecasCudaPendentes) {
    console.log("  Atenção: GPU NVIDIA presente, mas o Whisper não a enxerga. Rode `npm run setup`.");
  }
  console.log(`  Gravado em ${path.relative(process.cwd(), ARQUIVO_ACELERACAO)}`);
}
