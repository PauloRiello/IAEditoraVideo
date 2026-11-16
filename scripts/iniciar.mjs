// Inicia a IA Editora de Vídeo e abre a janela dela. Se já estiver aberta, só abre a janela.
// A aplicação roda sozinha, em segundo plano, sem depender de nenhum outro programa.
// Uso: npm run iniciar   (no Windows: atalho "IA Editora de Vídeo" ou windows\Iniciar.cmd)
// Opções: --sem-janela (não abre o navegador)

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { arquivoDeExecucao, dizer, emExecucao, exigirInstalacao, falhar, NODE, pastas } from "./lib/aplicacao.mjs";
import { RAIZ, WINDOWS, chromeDoSistema, existeComando } from "./lib/comum.mjs";

const semJanela = process.argv.includes("--sem-janela") || process.env.IAEV_SEM_JANELAS === "1";

/** Navegador capaz de abrir a aplicação em janela própria (sem abas nem barra de endereço). */
function navegadorComJanelaPropria() {
  if (WINDOWS) {
    const bases = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
    for (const relativo of ["Microsoft\\Edge\\Application\\msedge.exe", "Google\\Chrome\\Application\\chrome.exe"]) {
      for (const base of bases) if (existsSync(path.join(base, relativo))) return path.join(base, relativo);
    }
    return null;
  }
  if (process.platform === "darwin") {
    for (const app of ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]) if (existsSync(app)) return app;
    return null;
  }
  for (const comando of ["google-chrome", "chromium", "chromium-browser", "microsoft-edge"]) {
    const achado = existeComando(comando);
    if (achado) return achado;
  }
  return chromeDoSistema() ?? null;
}

function abrirJanela(url) {
  const solto = { detached: true, stdio: "ignore", windowsHide: false };
  const navegador = navegadorComJanelaPropria();
  try {
    if (navegador) spawn(navegador, [`--app=${url}`, "--window-size=1440,900"], solto).on("error", () => undefined).unref();
    else if (WINDOWS) spawn("cmd", ["/c", "start", "", url], solto).on("error", () => undefined).unref();
    else spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], solto).on("error", () => undefined).unref();
    return true;
  } catch {
    return false;
  }
}

exigirInstalacao();
const { dados, registros } = pastas();
let execucao = await emExecucao(dados);

if (execucao) {
  dizer("A IA Editora de Vídeo já está aberta.");
} else {
  mkdirSync(registros, { recursive: true });
  const registro = path.join(registros, "aplicacao.log");
  if (existsSync(registro) && statSync(registro).size > 5 * 1024 * 1024) renameSync(registro, `${registro}.anterior`);
  const principal = path.join(RAIZ, "src", "interface", "principal.ts");
  let saiu = null;
  if (WINDOWS) {
    // No Windows a aplicação recebe um console invisível, pelo Start-Process -WindowStyle Hidden.
    // Tudo o que ela abrir (Remotion, FFmpeg, navegador de render, motor da IA) herda esse
    // console, e nenhuma janela de prompt aparece. A própria aplicação grava o registro.
    const aspas = (texto) => `'${String(texto).replace(/'/g, "''")}'`;
    const argumentos = [...NODE, principal].map((a) => `"${a}"`).join(" ");
    const comando = `Start-Process -FilePath ${aspas(process.execPath)} -ArgumentList ${aspas(argumentos)} -WorkingDirectory ${aspas(RAIZ)} -WindowStyle Hidden`;
    const lancador = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(comando, "utf16le").toString("base64")], {
      cwd: RAIZ, detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, IAEV_REGISTRO: registro },
    });
    lancador.on("exit", (codigo) => { if (codigo) saiu = codigo; }); // só falha se o próprio Start-Process falhar
    lancador.on("error", () => { saiu = 1; });
    lancador.unref();
  } else {
    const saida = openSync(registro, "a");
    const processo = spawn(process.execPath, [...NODE, principal], { cwd: RAIZ, detached: true, stdio: ["ignore", saida, saida], windowsHide: true });
    processo.on("exit", (codigo) => { saiu = codigo ?? 1; });
    processo.unref();
  }

  dizer("Iniciando a IA Editora de Vídeo...");
  for (let i = 0; i < 240 && !execucao && saiu === null; i += 1) {
    await new Promise((resolver) => setTimeout(resolver, 250));
    if (existsSync(arquivoDeExecucao(dados))) execucao = await emExecucao(dados);
  }
  if (!execucao) {
    const ultimas = existsSync(registro) ? readFileSync(registro, "utf8").trim().split("\n").slice(-6).join("\n  ") : "";
    falhar(saiu === null ? "a aplicação demorou demais para responder." : "a aplicação fechou logo ao iniciar.", `veja o registro em ${registro}.${ultimas ? `\nÚltimas linhas:\n  ${ultimas}` : ""}`);
  }
  dizer("Aplicação iniciada.");
}

const url = `http://127.0.0.1:${execucao.porta}/?t=${execucao.token}`;
if (semJanela) dizer(`Janela não aberta (opção --sem-janela). A aplicação está na porta ${execucao.porta}.`);
else if (abrirJanela(url)) dizer("Janela aberta. Para fechar a aplicação, use o botão Encerrar na própria janela (ou Parar).");
else dizer(`Não foi possível abrir a janela sozinho. Abra este endereço no navegador:\n  ${url}`);
