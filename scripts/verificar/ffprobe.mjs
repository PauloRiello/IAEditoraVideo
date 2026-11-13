// Verifica o FFprobe: gera um vídeo conhecido e confere se os dados lidos batem.
import path from "node:path";
import { Relatorio, comPastaTemporaria, executar, sondar } from "../lib/comum.mjs";

const r = new Relatorio("FFprobe");

const versao = executar("ffprobe", ["-version"]);
if (r.conferir(versao.ok, versao.saida.split(/\r?\n/)[0], "ffprobe não encontrado no PATH")) {
  await comPastaTemporaria((pasta) => {
    const arquivo = path.join(pasta, "amostra.mp4");
    const gerado = executar("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=duration=2:size=640x360:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      arquivo,
    ]);
    if (!r.conferir(gerado.ok, "Vídeo de amostra gerado", "Não foi possível gerar o vídeo de amostra")) return;

    const dados = sondar(arquivo);
    if (!r.conferir(dados, "Saída JSON lida", "ffprobe não devolveu JSON válido")) return;

    const video = dados.streams.find((s) => s.codec_type === "video");
    const audio = dados.streams.find((s) => s.codec_type === "audio");
    r.conferir(video?.codec_name === "h264", "Codec de vídeo: h264", `Codec de vídeo inesperado: ${video?.codec_name}`);
    r.conferir(video?.width === 640 && video?.height === 360, "Resolução: 640x360", `Resolução inesperada: ${video?.width}x${video?.height}`);
    r.conferir(video?.r_frame_rate === "30/1", "Taxa de quadros: 30 fps", `Taxa inesperada: ${video?.r_frame_rate}`);
    r.conferir(audio?.codec_name === "aac", "Codec de áudio: aac", `Codec de áudio inesperado: ${audio?.codec_name}`);
    const duracao = Number(dados.format.duration);
    r.conferir(Math.abs(duracao - 2) < 0.2, `Duração: ${duracao.toFixed(2)} s`, `Duração inesperada: ${duracao}`);
  });
}

r.finalizar();
