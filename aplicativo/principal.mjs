// Aplicativo da IA Editora de Vídeo (Electron): o programa que o usuário abre.
// Mostra a tela de abertura com a porcentagem, prepara o computador na primeira vez,
// inicia o servidor (src/interface/principal.ts) como processo filho, rodando este mesmo
// executável como Node e sem console, e mostra a página numa janela própria. Nada de prompt:
// o servidor e tudo o que ele abre (Remotion, FFmpeg, Python) herdam um console invisível.

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { iniciarAtualizacao } from "./atualizacao.mjs";
import { ambienteDoServidor, fracaoDaAbertura, lerLinha, podeInstalarAgora } from "./estado.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PROGRAMA = path.resolve(AQUI, "..");
const TITULO = "IA Editora de Vídeo";

// Mesmas pastas da instalação anterior (Instalar.cmd): os dados existentes são reaproveitados.
const DADOS = process.env.IAEV_DADOS ?? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), ".local", "share"), "IAEditoraVideo");
const BIBLIOTECA = process.env.IAEV_BIBLIOTECA ?? path.join(os.homedir(), "Documents", "IA Editora de Vídeo");
const AMBIENTE = process.env.IAEV_AMBIENTE ?? path.join(DADOS, "ambiente");
const REGISTRO = path.join(DADOS, "logs", "aplicativo.log");
const ENV_DO_SERVIDOR = {
  ...process.env,
  ...ambienteDoServidor({ dados: DADOS, biblioteca: BIBLIOTECA, ambiente: AMBIENTE, pathAtual: process.env.PATH ?? "", registro: REGISTRO }),
};
/** Tempo máximo para o servidor ficar pronto depois de iniciado. */
const ESPERA_DO_SERVIDOR_MS = 3 * 60_000;

/** @type {BrowserWindow | null} */ let abertura = null;
/** @type {BrowserWindow | null} */ let janela = null;
/** @type {import("node:child_process").ChildProcess | null} */ let servidor = null;
/** @type {{ porta: number, token: string } | null} */ let sessao = null;
let saindo = false;
/** @type {ReturnType<typeof iniciarAtualizacao> | null} */ let atualizacao = null;

function registrar(texto) {
  try {
    mkdirSync(path.dirname(REGISTRO), { recursive: true });
    appendFileSync(REGISTRO, `${new Date().toISOString()} [aplicativo] ${texto}\n`);
  } catch {
    // sem onde registrar: segue sem registro
  }
}
const ultimasLinhasDoRegistro = () => {
  try {
    return readFileSync(REGISTRO, "utf8").trim().split(/\r?\n/).slice(-8).join("\n");
  } catch {
    return "";
  }
};

// Uma instância só: abrir de novo traz a janela existente para a frente.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const alvo = janela ?? abertura;
    if (!alvo) return;
    if (alvo.isMinimized()) alvo.restore();
    alvo.show();
    alvo.focus();
  });
  app.whenReady().then(() => {
    criarAbertura();
    void abrir();
    // Só o programa instalado se atualiza (no desenvolvimento, quem atualiza é o Git).
    if (app.isPackaged) atualizacao = iniciarAtualizacao({ aoMudar: (texto, pronta) => janela?.webContents.send("iaev:atualizacao", texto, pronta), registrar });
  });
}

ipcMain.on("iaev:versao", (evento) => (evento.returnValue = app.getVersion()));
ipcMain.on("iaev:tentar-de-novo", () => void abrir());
ipcMain.on("iaev:fechar", () => app.quit());
ipcMain.on("iaev:estado-atualizacao", (evento) => (evento.returnValue = atualizacao?.estado() ?? { texto: "A atualização automática funciona no programa instalado.", pronta: false }));
ipcMain.on("iaev:reiniciar-para-atualizar", () => void fecharComCuidado({ atualizar: true }));

const preferencias = () => ({ preload: path.join(AQUI, "ponte.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false });

function criarAbertura() {
  abertura = new BrowserWindow({ width: 520, height: 320, frame: false, resizable: false, show: false, backgroundColor: "#14161a", title: TITULO, icon: path.join(AQUI, "icone.svg"), webPreferences: preferencias() });
  abertura.once("ready-to-show", () => abertura?.show());
  abertura.on("closed", () => (abertura = null));
  void abertura.loadFile(path.join(AQUI, "abertura.html"));
}

let ultimaFracao = 0;
function mostrar(etapa, fracao) {
  ultimaFracao = Math.max(ultimaFracao, fracao); // a barra só avança
  abertura?.webContents.send("iaev:abertura", { etapa, fracao: ultimaFracao });
}
function mostrarErro(mensagem) {
  registrar(`Falha ao abrir: ${mensagem}`);
  abertura?.webContents.send("iaev:abertura", { erro: mensagem, registro: ultimasLinhasDoRegistro() });
}

/** Executa um script do programa com este executável como Node, entregando cada linha JSON. */
function executarComoNode(script, aoLinha) {
  const filho = spawn(process.execPath, [path.join(PROGRAMA, script)], { cwd: PROGRAMA, env: ENV_DO_SERVIDOR, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let resto = "";
  filho.stdout.on("data", (bloco) => {
    const linhas = (resto + bloco.toString()).split(/\r?\n/);
    resto = linhas.pop() ?? "";
    for (const texto of linhas) {
      const linha = lerLinha(texto);
      if (linha) aoLinha(linha);
      else if (texto.trim()) registrar(`(${path.basename(script)}) ${texto}`);
    }
  });
  filho.stderr.on("data", (bloco) => registrar(`(${path.basename(script)}) ${bloco.toString().trimEnd()}`));
  return filho;
}

let abrindo = false;
async function abrir() {
  if (abrindo) return;
  abrindo = true;
  ultimaFracao = 0;
  try {
    mostrar("Conferindo o computador", 0);
    const preparado = await preparar();
    if (!preparado) return;
    await iniciarServidor();
  } finally {
    abrindo = false;
  }
}

/** Prepara o que falta no computador (só baixa na primeira vez). Falhas parciais não impedem abrir. */
function preparar() {
  return new Promise((resolver) => {
    let terminou = false;
    const filho = executarComoNode("src/interface/preparar.ts", (linha) => {
      if (linha.tipo === "etapa") mostrar(linha.etapa, fracaoDaAbertura("preparando", linha.fracao));
      else if (linha.tipo === "preparado") {
        terminou = true;
        for (const aviso of linha.avisos) registrar(`Preparação: ${aviso}`);
        if (linha.faltando.length) registrar(`Preparação: ainda falta ${linha.faltando.join(", ")}`);
      } else if (linha.tipo === "erro") {
        terminou = true;
        mostrarErro(`A preparação do computador falhou: ${linha.mensagem}`);
        resolver(false);
      }
    });
    filho.on("error", (erro) => { mostrarErro(`A preparação não pôde ser iniciada: ${erro.message}`); resolver(false); });
    filho.on("exit", (codigo) => {
      if (terminou && codigo === 0) resolver(true);
      else if (!terminou) { mostrarErro(`A preparação do computador parou sem terminar (código ${codigo}).`); resolver(false); }
    });
  });
}

function iniciarServidor() {
  return new Promise((resolver) => {
    let pronta = false;
    let motivo = "";
    const filho = executarComoNode("src/interface/principal.ts", (linha) => {
      if (linha.tipo === "etapa") mostrar(linha.etapa, fracaoDaAbertura("abrindo", linha.fracao));
      else if (linha.tipo === "pronta") {
        pronta = true;
        clearTimeout(limite);
        sessao = { porta: linha.porta, token: linha.token };
        mostrar("Abrindo a janela", 1);
        abrirJanela();
        resolver();
      } else if (linha.tipo === "erro") motivo = linha.mensagem;
    });
    servidor = filho;
    const limite = setTimeout(() => {
      if (pronta) return;
      mostrarErro("O programa demorou demais para abrir.");
      filho.kill();
    }, ESPERA_DO_SERVIDOR_MS);
    filho.on("error", (erro) => { clearTimeout(limite); mostrarErro(`O programa não pôde ser iniciado: ${erro.message}`); resolver(); });
    filho.on("exit", (codigo) => {
      clearTimeout(limite);
      servidor = null;
      if (!pronta) {
        mostrarErro(motivo ? `O programa não abriu: ${motivo}` : `O programa fechou ao abrir (código ${codigo}).`);
        resolver();
      } else if (!saindo) {
        // Encerrado pela própria página (botão Encerrar) ou já aberto por outro inicializador.
        saindo = true;
        void finalizar();
      }
    });
  });
}

function abrirJanela() {
  if (!sessao) return;
  janela = new BrowserWindow({ width: 1366, height: 860, minWidth: 960, minHeight: 600, show: false, backgroundColor: "#14161a", title: TITULO, icon: path.join(AQUI, "icone.svg"), autoHideMenuBar: true, webPreferences: preferencias() });
  const origem = `http://127.0.0.1:${sessao.porta}`;
  // Só a própria aplicação abre na janela; outros endereços vão para o navegador.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(origem)) void shell.openExternal(url);
    return { action: "deny" };
  });
  janela.webContents.on("will-navigate", (evento, url) => {
    if (!url.startsWith(origem)) { evento.preventDefault(); void shell.openExternal(url); }
  });
  janela.once("ready-to-show", () => {
    janela?.maximize();
    janela?.show();
    abertura?.close();
  });
  janela.on("close", (evento) => {
    if (saindo) return;
    evento.preventDefault();
    void fecharComCuidado();
  });
  janela.on("closed", () => (janela = null));
  void janela.loadURL(`${origem}/?t=${sessao.token}`);
}

/** Tarefas do servidor (análises, renders), pela sessão do aplicativo. */
async function tarefas() {
  if (!sessao) return [];
  try {
    const resposta = await fetch(`http://127.0.0.1:${sessao.porta}/api/tarefas`, { headers: { "x-iaev-sessao": sessao.token }, signal: AbortSignal.timeout(3000) });
    return resposta.ok ? await resposta.json() : [];
  } catch {
    return [];
  }
}

/** Fecha avisando se há trabalho em andamento, e espera o servidor terminar com calma. */
async function fecharComCuidado({ atualizar = false } = {}) {
  if (!podeInstalarAgora(await tarefas()) && janela) {
    if (atualizar) {
      // Nunca instala no meio de um trabalho: fica para quando o programa for fechado.
      await dialog.showMessageBox(janela, { type: "info", buttons: ["Entendi"], title: TITULO, message: "Há uma análise ou um render em andamento.", detail: "A atualização será instalada quando esse trabalho terminar e você fechar o programa." });
      return;
    }
    const { response } = await dialog.showMessageBox(janela, {
      type: "question", buttons: ["Continuar trabalhando", "Fechar e cancelar"], defaultId: 0, cancelId: 0, title: TITULO,
      message: "Há uma análise ou um render em andamento.", detail: "Se fechar agora, esse trabalho é cancelado. O que já foi salvo continua salvo.",
    });
    if (response === 0) return;
  }
  saindo = true;
  janela?.hide();
  await encerrarServidor();
  await finalizar();
}

/** Com o servidor já fechado: instala a atualização baixada (depois da cópia de segurança) ou só sai. */
async function finalizar() {
  if (atualizacao?.pronta()) {
    if (await copiaAntesDeAtualizar()) {
      registrar("Instalando a atualização.");
      atualizacao.instalar();
      return;
    }
    registrar("A cópia de segurança antes da atualização falhou: a atualização fica para a próxima vez.");
  }
  app.quit();
}

/** Cópia "pre-atualizacao" pela linha de comando da aplicação (com o servidor fechado, o banco está livre). */
function copiaAntesDeAtualizar() {
  return new Promise((resolver) => {
    const filho = spawn(process.execPath, [path.join(PROGRAMA, "src", "interface", "cli.ts"), "backup", "pre-atualizacao"], { cwd: PROGRAMA, env: ENV_DO_SERVIDOR, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    filho.stdout.on("data", (bloco) => registrar(`(backup) ${bloco.toString().trimEnd()}`));
    filho.stderr.on("data", (bloco) => registrar(`(backup) ${bloco.toString().trimEnd()}`));
    filho.on("error", () => resolver(false));
    filho.on("exit", (codigo) => resolver(codigo === 0));
  });
}

/** Fechar a entrada padrão pede ao servidor que encerre (cancela renders e fecha o banco). */
function encerrarServidor() {
  const filho = servidor;
  if (!filho) return Promise.resolve();
  return new Promise((resolver) => {
    const limite = setTimeout(() => { filho.kill(); resolver(); }, 30_000);
    filho.once("exit", () => { clearTimeout(limite); resolver(); });
    filho.stdin?.end();
  });
}

app.on("window-all-closed", () => {
  if (!janela && !servidor) app.quit();
});
app.on("before-quit", () => {
  saindo = true;
  servidor?.stdin?.end();
});

