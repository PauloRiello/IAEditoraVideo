// Verifica o Whisper (faster-whisper): importação, dispositivo e uma transcrição real.
import { existsSync } from "node:fs";
import path from "node:path";
import { RAIZ, Relatorio, binVenv, comPastaTemporaria, executar, lerAceleracao, resumo } from "../lib/comum.mjs";

const r = new Relatorio("Whisper (faster-whisper)");
const python = binVenv("python");
const MODELO = "tiny"; // o menor modelo: suficiente para validar a instalação
const FRASE = "The quick brown fox jumps over the lazy dog";

if (r.conferir(existsSync(python), "Ambiente virtual .venv presente", "Ambiente .venv ausente (rode npm run setup)")) {
  const aceleracao = lerAceleracao()?.whisper ?? { device: "cpu", computeType: "int8" };

  await comPastaTemporaria((pasta) => {
    // Fala sintética gerada pelo FFmpeg (filtro flite). Sem o filtro, usa um tom:
    // valida o funcionamento, mas não a qualidade da transcrição.
    const audio = path.join(pasta, "fala.wav");
    const fala = executar("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `flite=text='${FRASE}':voice=slt`,
      "-ar", "16000", "-ac", "1", audio,
    ]);
    if (!fala.ok) {
      executar("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-ar", "16000", "-ac", "1", audio]);
    }

    const teste = executar(python, [
      path.join(RAIZ, "scripts", "verificar", "whisper_teste.py"),
      audio, aceleracao.device, aceleracao.computeType, MODELO,
    ]);
    let dados;
    try {
      dados = JSON.parse(teste.saida.split(/\r?\n/).pop());
    } catch {
      r.falha(`Teste não executou: ${resumo(teste.erro || teste.saida)}`);
      return;
    }

    if (!r.conferir(dados.faster_whisper, `faster-whisper ${dados.faster_whisper} (ctranslate2 ${dados.ctranslate2})`, `Importação falhou: ${dados.erro}`)) return;
    r.ok(`Dispositivo: ${aceleracao.device} / ${aceleracao.computeType} (GPUs CUDA visíveis: ${dados.dispositivos_cuda})`);

    if (dados.etapa === "modelo") {
      r.falha(`Modelo "${MODELO}" não pôde ser carregado (o primeiro uso baixa de huggingface.co): ${dados.erro}`);
      return;
    }
    if (!r.conferir(dados.etapa === "concluido", `Modelo "${MODELO}" carregado em ${dados.carga_s} s`, `Transcrição falhou: ${dados.erro}`)) return;

    r.ok(`Transcrição em ${dados.transcricao_s} s: "${dados.texto}"`);
    if (fala.ok) {
      const normalizar = (texto) => texto.toLowerCase().replace(/[^a-z ]/g, "").split(/\s+/).filter(Boolean);
      const obtidas = new Set(normalizar(dados.texto));
      const esperadas = normalizar(FRASE);
      const acertos = esperadas.filter((palavra) => obtidas.has(palavra)).length;
      r.conferir(acertos >= esperadas.length - 2, `Texto reconhecido: ${acertos}/${esperadas.length} palavras`, `Texto divergente: ${acertos}/${esperadas.length} palavras`);
      r.conferir(dados.palavras_com_tempo > 0, `Marcação de tempo por palavra: ${dados.palavras_com_tempo} palavras`, "Sem marcação de tempo por palavra");
    } else {
      r.aviso("FFmpeg sem o filtro flite: transcrição executada sobre um tom, sem conferência de texto");
    }
  });
}

r.finalizar();
