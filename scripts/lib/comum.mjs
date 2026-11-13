// Funções compartilhadas pelos scripts de configuração e verificação.
// Usa apenas módulos nativos do Node.js: funciona antes de `npm install`.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const WINDOWS = process.platform === "win32";
export const ARQUIVO_ACELERACAO = path.join(RAIZ, "config", "local.aceleracao.json");

// Ambiente dos processos filhos: telemetria de terceiros desligada.
export const AMBIENTE = {
  ...process.env,
  HYPERFRAMES_NO_TELEMETRY: "1",
  DO_NOT_TRACK: "1",
  DISABLE_TELEMETRY: "1",
};

/** Executa um comando e devolve { ok, codigo, saida, erro } sem lançar exceção. */
export function executar(comando, argumentos = [], opcoes = {}) {
  const usaShell = WINDOWS && /\.(cmd|bat)$/i.test(comando);
  const resultado = spawnSync(comando, argumentos, {
    cwd: RAIZ,
    env: AMBIENTE,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
    shell: usaShell,
    ...opcoes,
  });
  return {
    ok: resultado.status === 0 && !resultado.error,
    codigo: resultado.status,
    saida: (resultado.stdout ?? "").trim(),
    erro: (resultado.stderr ?? "").trim() || (resultado.error ? String(resultado.error.message) : ""),
  };
}

export function existeComando(comando) {
  const r = executar(WINDOWS ? "where" : "which", [comando]);
  return r.ok ? r.saida.split(/\r?\n/)[0] : null;
}

/** Executável instalado em node_modules/.bin. */
export function binLocal(nome) {
  return path.join(RAIZ, "node_modules", ".bin", WINDOWS ? `${nome}.cmd` : nome);
}

/** Executável do ambiente virtual Python (.venv). */
export function binVenv(nome) {
  return WINDOWS
    ? path.join(RAIZ, ".venv", "Scripts", `${nome}.exe`)
    : path.join(RAIZ, ".venv", "bin", nome);
}

/** Interpretador Python do sistema (3.11+), como [comando, ...argumentos]. */
export function pythonDoSistema() {
  const candidatos = WINDOWS ? [["py", "-3"], ["python"], ["python3"]] : [["python3"], ["python"]];
  for (const [comando, ...argumentos] of candidatos) {
    const r = executar(comando, [...argumentos, "-c", "import sys; print('%d.%d.%d' % sys.version_info[:3])"]);
    if (!r.ok) continue;
    const [maior, menor] = r.saida.split(".").map(Number);
    if (maior === 3 && menor >= 11) return { comando, argumentos, versao: r.saida };
  }
  return null;
}

export function lerJson(arquivo) {
  return JSON.parse(readFileSync(arquivo, "utf8"));
}

export function lerAceleracao() {
  return existsSync(ARQUIVO_ACELERACAO) ? lerJson(ARQUIVO_ACELERACAO) : null;
}

/** Versão instalada de um pacote npm, lida de node_modules. */
export function versaoPacote(nome) {
  const arquivo = path.join(RAIZ, "node_modules", nome, "package.json");
  return existsSync(arquivo) ? lerJson(arquivo).version : null;
}

/** Versões declaradas no package.json do projeto. */
export function versoesDeclaradas() {
  const pacote = lerJson(path.join(RAIZ, "package.json"));
  return { ...pacote.dependencies, ...pacote.devDependencies };
}

/** Cria uma pasta temporária, executa a função e apaga a pasta ao final. */
export async function comPastaTemporaria(funcao) {
  const pasta = mkdtempSync(path.join(os.tmpdir(), "iaev-"));
  try {
    return await funcao(pasta);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

/** Lê os dados de um arquivo de mídia com o ffprobe. */
export function sondar(arquivo) {
  const r = executar("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", arquivo]);
  return r.ok ? JSON.parse(r.saida) : null;
}

/** Chrome do sistema, usado apenas quando o navegador próprio da ferramenta não está disponível. */
export function chromeDoSistema() {
  const fixos = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  for (const caminho of fixos) if (existsSync(caminho)) return caminho;
  for (const nome of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const caminho = existeComando(nome);
    if (caminho) return caminho;
  }
  return null;
}

/** Acumula resultados de uma verificação e define o código de saída. */
export class Relatorio {
  constructor(titulo) {
    this.titulo = titulo;
    this.falhas = 0;
    this.avisos = 0;
    console.log(`\n== ${titulo} ==`);
  }
  ok(mensagem) {
    console.log(`  [OK]    ${mensagem}`);
  }
  aviso(mensagem) {
    this.avisos += 1;
    console.log(`  [AVISO] ${mensagem}`);
  }
  falha(mensagem) {
    this.falhas += 1;
    console.log(`  [FALHA] ${mensagem}`);
  }
  /** Registra OK ou FALHA conforme a condição; devolve a condição. */
  conferir(condicao, mensagemOk, mensagemFalha) {
    if (condicao) this.ok(mensagemOk);
    else this.falha(mensagemFalha ?? mensagemOk);
    return Boolean(condicao);
  }
  finalizar() {
    const situacao = this.falhas > 0 ? "FALHOU" : this.avisos > 0 ? "OK com avisos" : "OK";
    console.log(`  Resultado: ${situacao} (${this.falhas} falha(s), ${this.avisos} aviso(s))`);
    process.exitCode = this.falhas > 0 ? 1 : 0;
  }
}

/** Últimas linhas de um texto, para mensagens de erro curtas. */
export function resumo(texto, linhas = 3) {
  return String(texto ?? "")
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .split(/\r?\n/)
    .filter((linha) => linha.trim())
    .slice(-linhas)
    .join(" | ")
    .slice(0, 400);
}
