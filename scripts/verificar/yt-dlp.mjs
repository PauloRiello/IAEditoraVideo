// Verifica o yt-dlp: versão, um download real (servidor local) e uma consulta online ao YouTube.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { RAIZ, Relatorio, binVenv, comPastaTemporaria, executar, resumo, sondar } from "../lib/comum.mjs";

const r = new Relatorio("yt-dlp");
const ytdlp = binVenv("yt-dlp");
const python = binVenv("python");
const VIDEO = "https://www.youtube.com/watch?v=jNQXAC9IVRw"; // "Me at the zoo", 19 s

if (r.conferir(existsSync(ytdlp), "yt-dlp instalado no .venv", "yt-dlp ausente (rode npm run setup)")) {
  const versao = executar(ytdlp, ["--version"]);
  r.conferir(versao.ok, `yt-dlp ${versao.saida}`, "yt-dlp não executa");

  const ejs = executar(python, ["-c", "import importlib.metadata as m; print(m.version('yt-dlp-ejs'))"]);
  r.conferir(ejs.ok, `yt-dlp-ejs ${ejs.saida} (suporte completo ao YouTube)`, "yt-dlp-ejs ausente");

  r.conferir(existsSync(path.join(RAIZ, "config", "yt-dlp.conf")), "config/yt-dlp.conf presente");

  // Teste 1: download real, sem depender da internet. Um servidor local entrega um vídeo gerado pelo FFmpeg.
  await comPastaTemporaria(async (pasta) => {
    const origem = path.join(pasta, "origem");
    const destino = path.join(pasta, "destino");
    executar("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=30",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(pasta, "amostra.mp4"),
    ]);
    executar(python, ["-c", `import os, shutil; os.makedirs(r"${origem}"); shutil.move(r"${path.join(pasta, "amostra.mp4")}", r"${origem}")`]);

    const porta = 20000 + Math.floor(Math.random() * 20000);
    const servidor = spawn(python, ["-m", "http.server", String(porta), "--bind", "127.0.0.1", "--directory", origem], { stdio: "ignore" });
    try {
      const url = `http://127.0.0.1:${porta}/amostra.mp4`;
      const pronto = executar(python, ["-c", `
import time, urllib.request
for _ in range(50):
    try:
        urllib.request.build_opener(urllib.request.ProxyHandler({})).open("${url}", timeout=1).close()
        break
    except Exception:
        time.sleep(0.2)
else:
    raise SystemExit(1)`]);
      if (!r.conferir(pronto.ok, "Servidor local de teste iniciado", "Servidor local de teste não iniciou")) return;

      const baixado = executar(ytdlp, ["--ignore-config", "--proxy", "", "--quiet", "--no-warnings", "-o", path.join(destino, "baixado.%(ext)s"), url]);
      const arquivo = path.join(destino, "baixado.mp4");
      const video = baixado.ok && existsSync(arquivo) ? sondar(arquivo)?.streams.find((s) => s.codec_type === "video") : null;
      r.conferir(
        video?.codec_name === "h264" && video.width === 320,
        "Download real concluído e validado (h264, 320x240)",
        `Download local falhou: ${resumo(baixado.erro || baixado.saida)}`,
      );
    } finally {
      servidor.kill();
    }
  });

  // Teste 2: consulta online ao YouTube (--simulate: nada é baixado). Depende da rede e do
  // YouTube aceitar o IP da máquina; um bloqueio aqui não indica defeito na instalação.
  const dados = executar(ytdlp, [
    "--config-locations", "config/yt-dlp.conf",
    "--simulate", "--print", "%(id)s|%(duration)s|%(title)s", VIDEO,
  ], { timeout: 120000 });
  const linha = dados.saida.split(/\r?\n/).pop() ?? "";
  if (dados.ok && linha.startsWith("jNQXAC9IVRw|")) {
    r.ok(`Consulta ao YouTube: ${linha}`);
  } else if (/not a bot|Sign in to confirm/i.test(dados.erro)) {
    r.aviso("YouTube exigiu verificação anti-robô para o IP desta máquina (comum em servidores): consulta online não validada");
  } else if (/Tunnel connection failed|Unable to connect to proxy|getaddrinfo|Name or service not known|timed out/i.test(dados.erro)) {
    r.aviso("Rede desta máquina bloqueia o YouTube: consulta online não validada");
  } else {
    r.falha(`Consulta ao YouTube falhou: ${resumo(dados.erro)}`);
  }
}

r.finalizar();
