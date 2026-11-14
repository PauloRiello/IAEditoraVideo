// Verifica o HyperFrames: versão, lint e um render real de 1 segundo com GSAP local.
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import {
  AMBIENTE, RAIZ, Relatorio, binLocal, chromeDoSistema, comPastaTemporaria, executar, lerAceleracao, navegadorDoRemotion, resumo, sondar, versaoPacote,
} from "../lib/comum.mjs";

const r = new Relatorio("HyperFrames");
const hyperframes = binLocal("hyperframes");
const projeto = "tests/smoke/hyperframes";

if (r.conferir(existsSync(hyperframes), `hyperframes ${versaoPacote("hyperframes")}`, "HyperFrames não instalado (rode npm install)")) {
  // O teste usa o GSAP instalado pelo npm, sem depender de CDN.
  const assets = path.join(RAIZ, projeto, "assets");
  mkdirSync(assets, { recursive: true });
  copyFileSync(path.join(RAIZ, "node_modules", "gsap", "dist", "gsap.min.js"), path.join(assets, "gsap.min.js"));

  const lint = executar(hyperframes, ["lint", projeto]);
  r.conferir(lint.ok && /0 errors/.test(lint.saida + lint.erro), "Lint da composição de teste: 0 erros", `Lint falhou: ${resumo(lint.saida || lint.erro)}`);

  await comPastaTemporaria((pasta) => {
    const saida = path.join(pasta, "hyperframes.mp4");
    let gpu = lerAceleracao()?.hyperframes?.gpuEncoding ? ["--gpu"] : [];
    const renderizar = (opcoesDeGpu, navegador) => {
      rmSync(saida, { force: true });
      const resultado = executar(hyperframes, ["render", projeto, "-o", saida, "--fps", "30", "--workers", "1", ...opcoesDeGpu], navegador ? { env: { ...AMBIENTE, HYPERFRAMES_BROWSER_PATH: navegador } } : {});
      return { ...resultado, ok: resultado.ok && existsSync(saida) };
    };
    let render = renderizar(gpu);
    if (!render.ok) {
      // O navegador próprio do HyperFrames não abriu ou a GPU atrapalhou: tenta as alternativas
      // que a aplicação também usa, e diz qual funcionou.
      const primeiraFalha = resumo(render.erro || render.saida);
      const alternativas = [
        ...(gpu.length ? [["sem a opção --gpu", [], null]] : []),
        ...[["o navegador do Remotion", navegadorDoRemotion()], ["o Chrome ou o Edge do sistema", chromeDoSistema()]].filter(([, caminho]) => caminho).map(([nome, caminho]) => [`${nome} (${caminho})`, [], caminho]),
      ];
      for (const [nome, opcoesDeGpu, navegador] of alternativas) {
        render = renderizar(opcoesDeGpu, navegador);
        if (render.ok) {
          gpu = opcoesDeGpu;
          r.aviso(`O render padrão falhou (${primeiraFalha}), mas funcionou com ${nome}. A aplicação faz essa troca sozinha; se nenhum navegador servir, o cartão final é desenhado pelo Remotion`);
          break;
        }
      }
      if (!render.ok) {
        r.aviso(`O HyperFrames não conseguiu renderizar (${primeiraFalha}), nem com as alternativas (${alternativas.map(([nome]) => nome).join("; ") || "nenhuma disponível"}). A aplicação continua funcionando: o cartão final é desenhado pelo Remotion. Para tentar corrigir: npx hyperframes browser ensure --force`);
        return;
      }
    }
    r.ok("Render concluído");

    const video = sondar(saida)?.streams.find((s) => s.codec_type === "video");
    r.conferir(
      video?.codec_name === "h264" && video.width === 1280 && video.height === 720 && Number(video.nb_frames) === 30,
      "Vídeo gerado: h264, 1280x720, 30 quadros",
      `Vídeo inesperado: ${JSON.stringify(video && { c: video.codec_name, w: video.width, h: video.height, n: video.nb_frames })}`,
    );
    r.ok(`Codificação por GPU: ${gpu.length ? "ativada" : "desativada"}`);
    if (/Using system Chrome/.test(render.saida + render.erro)) {
      r.aviso("Usando o Chrome do sistema (modo captura de tela); com chrome-headless-shell o render é mais rápido");
    }
  });
}

r.finalizar();
