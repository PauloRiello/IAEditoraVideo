// Verifica o Remotion: versões, listagem de composições e um render real de 1 segundo.
import { existsSync } from "node:fs";
import path from "node:path";
import {
  RAIZ, Relatorio, binLocal, chromeDoSistema, comPastaTemporaria, executar, resumo, sondar, versaoPacote,
} from "../lib/comum.mjs";

const r = new Relatorio("Remotion");
const remotion = binLocal("remotion");
const entrada = "tests/smoke/remotion/index.ts";

if (r.conferir(existsSync(remotion), `remotion ${versaoPacote("remotion")}`, "Remotion não instalado (rode npm install)")) {
  const versoes = executar(remotion, ["versions"]);
  r.conferir(versoes.ok, "Pacotes do Remotion na mesma versão", `Versões divergentes: ${resumo(versoes.saida + versoes.erro)}`);

  // Navegador: o Remotion baixa o próprio Chrome Headless Shell. Se o download
  // não for possível (rede restrita), o teste usa o Chrome do sistema.
  const navegador = [];
  const proprio = executar(remotion, ["browser", "ensure"], { env: { ...process.env, NODE_USE_ENV_PROXY: "1" } });
  if (proprio.ok) {
    r.ok("Chrome Headless Shell do Remotion disponível");
  } else {
    const chrome = chromeDoSistema();
    if (chrome) {
      navegador.push(`--browser-executable=${chrome}`);
      r.aviso(`Chrome Headless Shell não pôde ser baixado; usando o Chrome do sistema (${chrome})`);
    } else {
      r.falha(`Nenhum navegador disponível para o render: ${resumo(proprio.erro)}`);
    }
  }

  if (r.falhas === 0) {
    const lista = executar(remotion, ["compositions", entrada, ...navegador]);
    r.conferir(lista.ok && /Teste/.test(lista.saida + lista.erro), "Composição de teste encontrada", `Listagem falhou: ${resumo(lista.erro || lista.saida)}`);

    await comPastaTemporaria((pasta) => {
      const saida = path.join(pasta, "remotion.mp4");
      const render = executar(remotion, ["render", entrada, "Teste", saida, "--log=verbose", ...navegador]);
      if (!r.conferir(render.ok && existsSync(saida), "Render concluído", `Render falhou: ${resumo(render.erro || render.saida)}`)) return;

      const video = sondar(saida)?.streams.find((s) => s.codec_type === "video");
      r.conferir(
        video?.codec_name === "h264" && video.width === 640 && video.height === 360 && Number(video.nb_frames) === 30,
        "Vídeo gerado: h264, 640x360, 30 quadros",
        `Vídeo inesperado: ${JSON.stringify(video && { c: video.codec_name, w: video.width, h: video.height, n: video.nb_frames })}`,
      );
      const encoder = (render.saida + render.erro).match(/Encoder: (\S+), hardware accelerated: (true|false)/);
      if (encoder) r.ok(`Encoder usado: ${encoder[1]} (aceleração por hardware: ${encoder[2] === "true" ? "sim" : "não"})`);
    });
  }
}

r.conferir(existsSync(path.join(RAIZ, "remotion.config.ts")), "remotion.config.ts presente");
r.finalizar();
