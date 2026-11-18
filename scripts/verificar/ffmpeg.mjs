// Verifica o FFmpeg: versão, encoders essenciais e uma codificação real de vídeo com áudio.
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { Relatorio, comPastaTemporaria, executar, lerAceleracao, resumo } from "../lib/comum.mjs";

const r = new Relatorio("FFmpeg");

const versao = executar("ffmpeg", ["-version"]);
if (r.conferir(versao.ok, versao.saida.split(/\r?\n/)[0], "ffmpeg não encontrado no PATH")) {
  const encoders = executar("ffmpeg", ["-hide_banner", "-encoders"]).saida;
  for (const nome of ["libx264", "aac"]) {
    r.conferir(new RegExp(`\\s${nome}\\s`).test(encoders), `Encoder ${nome} disponível`, `Encoder ${nome} ausente`);
  }

  await comPastaTemporaria((pasta) => {
    const codificar = (encoder) => {
      const saida = path.join(pasta, `${encoder}.mp4`);
      const teste = executar("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc=duration=1:size=640x360:rate=30",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
        "-c:v", encoder, "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
        saida,
      ]);
      return { ok: teste.ok && existsSync(saida) && statSync(saida).size > 0, erro: teste.erro };
    };

    const cpu = codificar("libx264");
    r.conferir(cpu.ok, "Codificação H.264 + AAC por CPU (libx264)", `Codificação por CPU falhou: ${resumo(cpu.erro)}`);

    const encoder = lerAceleracao()?.ffmpeg?.encoderH264;
    if (encoder && encoder !== "libx264") {
      const gpu = codificar(encoder);
      r.conferir(gpu.ok, `Codificação por hardware (${encoder})`, `Codificação com ${encoder} falhou: ${resumo(gpu.erro)}`);
    } else {
      r.ok("Aceleração por hardware não configurada nesta máquina (usa CPU)");
    }
  });
}

r.finalizar();
