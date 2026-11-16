// Inicia a IA Editora de Vídeo e abre a janela dela. Se já estiver aberta, só abre a janela.
// A aplicação roda sozinha, em segundo plano, sem depender de nenhum outro programa.
// Uso: npm run iniciar   (no Windows: atalho "IA Editora de Vídeo" ou windows\Iniciar.cmd)
// Opções: --sem-janela (não abre o navegador)

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
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

/**
 * No Windows, o atalho roda o inicializador numa janela minimizada que fecha sozinha: um
 * erro escrito só nela sumiria. Por isso a falha também aparece numa caixa de mensagem.
 */
function avisarNaTela(texto) {
  if (!WINDOWS || process.env.IAEV_SEM_JANELAS === "1") return;
  const comando = `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${texto.replace(/'/g, "''")}', 'IA Editora de Video', 'OK', 'Error') | Out-Null`;
  spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(comando, "utf16le").toString("base64")], { windowsHide: true });
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
  const marcador = path.join(dados, "abrindo.json");
  const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));
  const vivo = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const pronta = async () => (existsSync(arquivoDeExecucao(dados)) ? emExecucao(dados) : null);

  /** Jeito simples (e o único fora do Windows): processo próprio, com a saída no registro. */
  const abrirDireto = () => {
    const saida = openSync(registro, "a");
    const processo = spawn(process.execPath, [...NODE, principal], { cwd: RAIZ, detached: true, stdio: ["ignore", saida, saida], windowsHide: true });
    const estado = { saiu: null };
    processo.on("exit", (codigo) => { estado.saiu = codigo ?? 1; });
    processo.unref();
    return estado;
  };

  /**
   * Windows: a aplicação recebe um console invisível (Start-Process -WindowStyle Hidden).
   * Tudo o que ela abrir (Remotion, FFmpeg, navegador de render, motor da IA) herda esse
   * console, e nenhuma janela de prompt aparece. Devolve false se a aplicação não deu sinal
   * de vida, para o inicializador usar o jeito simples.
   */
  const abrirOculta = async () => {
    rmSync(marcador, { force: true });
    const aspas = (texto) => `'${String(texto).replace(/'/g, "''")}'`;
    const argumentos = [...NODE, path.join(RAIZ, "scripts", "lib", "abrir-oculta.mjs"), principal].map((a) => `"${a}"`).join(" ");
    const comando = process.env.IAEV_TESTE_ABERTURA_OCULTA === "falha"
      ? "exit 0" // (testes) simula um Start-Process que não abre nada
      : `Start-Process -FilePath ${aspas(process.execPath)} -ArgumentList ${aspas(argumentos)} -WorkingDirectory ${aspas(RAIZ)} -WindowStyle Hidden`;
    const shell = WINDOWS ? "powershell" : "pwsh";
    const lancador = spawn(shell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(comando, "utf16le").toString("base64")], {
      cwd: RAIZ, detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, IAEV_REGISTRO: registro, IAEV_MARCADOR: marcador },
    });
    let falhou = false;
    lancador.on("error", () => { falhou = true; });
    lancador.unref();
    // Até 20 s para dar sinal de vida; depois, até 2 min para ficar pronta, enquanto o processo estiver vivo.
    for (let i = 0; i < 80 && !falhou && !existsSync(marcador); i += 1) await esperar(250);
    if (!existsSync(marcador)) return false;
    let pid = 0;
    try { pid = JSON.parse(readFileSync(marcador, "utf8")).pid; } catch { /* marcador incompleto */ }
    for (let i = 0; i < 480; i += 1) {
      execucao = await pronta();
      if (execucao) return true;
      if (pid && !vivo(pid)) return false;
      await esperar(250);
    }
    return false;
  };

  dizer("Iniciando a IA Editora de Vídeo...");
  const tentarOculta = WINDOWS || process.env.IAEV_TESTE_ABERTURA_OCULTA === "falha";
  if (tentarOculta && !(await abrirOculta())) {
    execucao = await pronta();
    if (!execucao) {
      appendFileSync(registro, `${new Date().toISOString()} A abertura com console invisível não funcionou; aberta do jeito simples (podem aparecer janelas de prompt na prévia).\n`);
      dizer("Abrindo do jeito simples (a abertura sem janelas não funcionou neste computador).");
    }
  }
  if (!execucao) {
    const direto = abrirDireto();
    for (let i = 0; i < 240 && !execucao && direto.saiu === null; i += 1) {
      await esperar(250);
      execucao = await pronta();
    }
    if (!execucao) {
      const ultimas = existsSync(registro) ? readFileSync(registro, "utf8").trim().split("\n").slice(-8).join("\n  ") : "";
      avisarNaTela(`A IA Editora de Vídeo não abriu.\n\n${ultimas.slice(-1200)}\n\nRegistro completo: ${registro}`);
      falhar(direto.saiu === null ? "a aplicação demorou demais para responder." : "a aplicação fechou logo ao iniciar.", `veja o registro em ${registro}.${ultimas ? `\nÚltimas linhas:\n  ${ultimas}` : ""}`);
    }
  }
  dizer("Aplicação iniciada.");
}

const url = `http://127.0.0.1:${execucao.porta}/?t=${execucao.token}`;
if (semJanela) dizer(`Janela não aberta (opção --sem-janela). A aplicação está na porta ${execucao.porta}.`);
else if (abrirJanela(url)) dizer("Janela aberta. Para fechar a aplicação, use o botão Encerrar na própria janela (ou Parar).");
else dizer(`Não foi possível abrir a janela sozinho. Abra este endereço no navegador:\n  ${url}`);
