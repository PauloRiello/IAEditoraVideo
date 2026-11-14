// HyperFrames como ferramenta complementar: renderiza cartões animados em HTML/CSS/GSAP
// (título, encerramento, chamada para ação) como um trecho de vídeo. O trecho entra na
// timeline como qualquer outro clipe; a composição final continua sendo do Remotion.

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ItemCartao } from "../../src/dominio/timeline.ts";
import { executarDetalhado } from "../analysis/ferramentas.ts";

const escapar = (texto: string) => texto.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

function paginaDoCartao(item: ItemCartao, largura: number, altura: number): string {
  const base = Math.min(largura, altura);
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${largura}, height=${altura}" />
    <script src="assets/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${largura}px; height: ${altura}px; overflow: hidden; background: ${item.corDeFundo}; }
      #root { width: 100%; height: 100%; }
      /* Um único bloco posicionado pelo HyperFrames; título, linha e subtítulo fluem dentro dele. */
      #conteudo { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${base * 0.035}px;
        font-family: Arial, Helvetica, sans-serif; color: ${item.corDoTexto}; text-align: center; padding: 0 8%; }
      #titulo { font-size: ${base * 0.085}px; font-weight: 800; line-height: 1.1; }
      #linha { width: ${base * 0.3}px; height: ${Math.max(2, base * 0.006)}px; background: ${item.corDoTexto}; }
      #subtitulo { font-size: ${base * 0.045}px; font-weight: 600; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${item.duracaoSeg}" data-width="${largura}" data-height="${altura}">
      <div id="conteudo" class="clip" data-start="0" data-duration="${item.duracaoSeg}" data-track-index="0">
        <h1 id="titulo">${escapar(item.titulo)}</h1>
        <div id="linha"></div>
        <p id="subtitulo">${escapar(item.subtitulo)}</p>
      </div>
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#titulo", { opacity: 0, y: ${base * 0.05} }, { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" }, 0.05);
      tl.fromTo("#linha", { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: "power2.out" }, 0.3);
      tl.fromTo("#subtitulo", { opacity: 0, y: ${base * 0.03} }, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" }, 0.45);
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
}

/** Chrome Headless Shell baixado pelo Remotion nesta instalação, se houver. */
function navegadorDoRemotion(programa: string): string | null {
  const base = path.join(programa, "node_modules", ".remotion", "chrome-headless-shell");
  if (!existsSync(base)) return null;
  for (const plataforma of readdirSync(base)) {
    const pasta = path.join(base, plataforma);
    if (!statSync(pasta).isDirectory()) continue;
    for (const versao of readdirSync(pasta)) {
      const executavel = path.join(pasta, versao, process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell");
      if (existsSync(executavel)) return executavel;
    }
  }
  return null;
}

/** Chrome ou Edge instalados no sistema. */
function navegadorDoSistema(): string | null {
  const candidatos = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ];
  return candidatos.find((caminho) => existsSync(caminho)) ?? null;
}

/**
 * Navegador que funcionou no último cartão: `undefined` = ainda não se sabe; `null` = o
 * próprio do HyperFrames; texto = caminho de um navegador alternativo.
 */
let navegadorQueFunciona: string | null | undefined;

/**
 * Renderiza o cartão em MP4. Se o navegador próprio do HyperFrames não abrir neste
 * computador, tenta o do Remotion e depois o Chrome ou o Edge do sistema. Lança erro se
 * nenhum servir; quem chama decide o que fazer (a composição sabe desenhar o cartão sozinha).
 */
export async function renderizarCartao(item: ItemCartao, formato: { largura: number; altura: number; fps: number }, destino: string, programa: string): Promise<void> {
  const executavel = path.join(programa, "node_modules", "hyperframes", "bin", "hyperframes.mjs");
  const gsap = path.join(programa, "node_modules", "gsap", "dist", "gsap.min.js");
  if (!existsSync(executavel) || !existsSync(gsap)) throw new Error("HyperFrames não está instalado.");
  if (process.env.IAEV_SEM_HYPERFRAMES === "1") throw new Error("HyperFrames desligado por IAEV_SEM_HYPERFRAMES."); // para testar o caminho sem ele

  const projeto = `${destino}.projeto`;
  mkdirSync(path.join(projeto, "assets"), { recursive: true });
  try {
    copyFileSync(gsap, path.join(projeto, "assets", "gsap.min.js"));
    writeFileSync(path.join(projeto, "index.html"), paginaDoCartao(item, formato.largura, formato.altura));
    writeFileSync(path.join(projeto, "meta.json"), JSON.stringify({ id: "cartao", name: "cartao" }));
    writeFileSync(path.join(projeto, "hyperframes.json"), JSON.stringify({ paths: { blocks: "compositions", components: "compositions/components", assets: "assets" } }));
    const candidatos = navegadorQueFunciona !== undefined
      ? [navegadorQueFunciona]
      : [null, navegadorDoRemotion(programa), navegadorDoSistema()].filter((caminho, i, lista) => i === 0 || (caminho !== null && lista.indexOf(caminho) === i));
    let falha = "";
    for (const navegador of candidatos) {
      rmSync(destino, { force: true });
      const r = await executarDetalhado(
        process.execPath,
        [executavel, "render", projeto, "-o", destino, "--fps", String(formato.fps), "--workers", "1"],
        { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1", ...(navegador ? { HYPERFRAMES_BROWSER_PATH: navegador } : {}) },
      );
      if (r.codigo === 0 && existsSync(destino)) {
        navegadorQueFunciona = navegador;
        return;
      }
      falha ||= r.erro.split("\n").slice(-2).join(" | ").slice(0, 300);
    }
    navegadorQueFunciona = undefined;
    throw new Error(`HyperFrames falhou: ${falha}`);
  } finally {
    rmSync(projeto, { recursive: true, force: true });
  }
}
