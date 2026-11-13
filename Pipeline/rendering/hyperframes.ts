// HyperFrames como ferramenta complementar: renderiza cartões animados em HTML/CSS/GSAP
// (título, encerramento, chamada para ação) como um trecho de vídeo. O trecho entra na
// timeline como qualquer outro clipe; a composição final continua sendo do Remotion.

import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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

/** Renderiza o cartão em MP4. Lança erro se o HyperFrames não puder ser executado. */
export async function renderizarCartao(item: ItemCartao, formato: { largura: number; altura: number; fps: number }, destino: string, programa: string): Promise<void> {
  const executavel = path.join(programa, "node_modules", "hyperframes", "bin", "hyperframes.mjs");
  const gsap = path.join(programa, "node_modules", "gsap", "dist", "gsap.min.js");
  if (!existsSync(executavel) || !existsSync(gsap)) throw new Error("HyperFrames não está instalado.");

  const projeto = `${destino}.projeto`;
  mkdirSync(path.join(projeto, "assets"), { recursive: true });
  try {
    copyFileSync(gsap, path.join(projeto, "assets", "gsap.min.js"));
    writeFileSync(path.join(projeto, "index.html"), paginaDoCartao(item, formato.largura, formato.altura));
    writeFileSync(path.join(projeto, "meta.json"), JSON.stringify({ id: "cartao", name: "cartao" }));
    writeFileSync(path.join(projeto, "hyperframes.json"), JSON.stringify({ paths: { blocks: "compositions", components: "compositions/components", assets: "assets" } }));
    const r = await executarDetalhado(
      process.execPath,
      [executavel, "render", projeto, "-o", destino, "--fps", String(formato.fps), "--workers", "1"],
      { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1" },
    );
    if (r.codigo !== 0 || !existsSync(destino)) throw new Error(`HyperFrames falhou: ${r.erro.split("\n").slice(-2).join(" | ").slice(0, 300)}`);
  } finally {
    rmSync(projeto, { recursive: true, force: true });
  }
}
