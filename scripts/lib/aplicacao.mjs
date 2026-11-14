// Funções comuns aos scripts de instalar, iniciar, parar, atualizar, backup e restaurar.
// Só módulos nativos do Node; funciona em Windows, macOS e Linux.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { RAIZ } from "./comum.mjs";

export const NODE = ["--disable-warning=ExperimentalWarning"];
export const dizer = (texto = "") => console.log(texto);

/** Encerra o script com uma mensagem que diz o que aconteceu e o que fazer. */
export function falhar(mensagem, oQueFazer) {
  console.error(`\nNão foi possível concluir: ${mensagem}`);
  if (oQueFazer) console.error(`O que fazer: ${oQueFazer}`);
  process.exit(1);
}

/** Confere o que a aplicação precisa para rodar; explica o que falta. */
export function exigirInstalacao() {
  const [maior, menor] = process.versions.node.split(".").map(Number);
  if (maior < 22 || (maior === 22 && menor < 20)) falhar(`o Node.js instalado (${process.versions.node}) é antigo demais.`, "instale o Node.js 22.20 ou mais recente e execute Instalar de novo.");
  if (!existsSync(path.join(RAIZ, "node_modules", "remotion"))) falhar("a aplicação ainda não foi instalada nesta pasta.", "execute Instalar (no Windows: windows\\Instalar.cmd; nos demais: npm run instalar).");
}

/** Executa um comando da aplicação (src/interface/cli.ts) e devolve o resultado. */
export function cli(argumentos, opcoes = {}) {
  const r = spawnSync(process.execPath, [...NODE, path.join(RAIZ, "src", "interface", "cli.ts"), ...argumentos], { cwd: RAIZ, encoding: "utf8", windowsHide: true, ...opcoes });
  return { ok: r.status === 0, saida: (r.stdout ?? "").trim(), erro: (r.stderr ?? "").trim() };
}

/** Onde ficam os dados e as mídias desta instalação. */
export function pastas() {
  const r = cli(["pastas"]);
  if (!r.ok) falhar("a aplicação não conseguiu informar as pastas de dados.", `confira a instalação (Instalar). Detalhe: ${r.erro.split("\n").slice(-2).join(" ")}`);
  return JSON.parse(r.saida);
}

export const arquivoDeExecucao = (dados) => path.join(dados, "execucao.json");

/** Dados da aplicação em execução (processo, porta e sessão), se estiver aberta e respondendo. */
export async function emExecucao(dados) {
  try {
    const execucao = JSON.parse(readFileSync(arquivoDeExecucao(dados), "utf8"));
    const resposta = await fetch(`http://127.0.0.1:${execucao.porta}/api/saude`, { signal: AbortSignal.timeout(2000) });
    const corpo = await resposta.json();
    return resposta.ok && corpo.aplicacao === "ia-editora-video" ? execucao : null;
  } catch {
    return null;
  }
}

/** Chama uma operação da aplicação aberta. */
export async function pedir(execucao, caminho, corpo) {
  const resposta = await fetch(`http://127.0.0.1:${execucao.porta}${caminho}`, {
    method: corpo === undefined ? "GET" : "POST", headers: { "x-iaev-sessao": execucao.token, ...(corpo === undefined ? {} : { "content-type": "application/json" }) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo), signal: AbortSignal.timeout(60_000),
  });
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok) throw new Error(dados?.erro?.mensagem ?? `a aplicação respondeu com o código ${resposta.status}`);
  return dados;
}

const vivo = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

/**
 * Encerra a aplicação com calma (renders são interrompidos com segurança e o banco é fechado).
 * Devolve false se ela não estava aberta.
 */
export async function parar(dados) {
  const execucao = await emExecucao(dados);
  if (!execucao) return false;
  try {
    await pedir(execucao, "/api/encerrar", {});
  } catch {
    // se o pedido falhar, o processo é encerrado pelo sinal abaixo
  }
  for (let i = 0; i < 80 && vivo(execucao.pid); i += 1) await esperar(250);
  if (vivo(execucao.pid)) {
    try {
      process.kill(execucao.pid);
    } catch {
      // já terminou
    }
    await esperar(500);
  }
  return true;
}

/** Cópias de segurança existentes, da mais recente para a mais antiga. */
export function copias(dados) {
  const pasta = path.join(dados, "backups");
  if (!existsSync(pasta)) return [];
  return readdirSync(pasta)
    .filter((nome) => /^\d{4}-\d\d-\d\dT[\d-]+Z_[a-z-]+?(-\d+)?$/.test(nome) && existsSync(path.join(pasta, nome, "editora.db")))
    .sort().reverse()
    .map((nome) => ({ nome, pasta: path.join(pasta, nome), quando: nome.slice(0, 10).split("-").reverse().join("/") + " " + nome.slice(11, 16).replace("-", ":") + " (UTC)", motivo: nome.split("_")[1].replace(/-\d+$/, "") }));
}

/**
 * Comando do PowerShell que cria o atalho da aplicação na Área de Trabalho e no Menu
 * Iniciar do Windows. O console do inicializador abre minimizado.
 */
export function comandoDoAtalho({ node, iniciar, raiz, icone }) {
  const aspas = (texto) => `'${String(texto).replace(/'/g, "''")}'`;
  return [
    "$w = New-Object -ComObject WScript.Shell",
    "foreach ($pasta in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {",
    "if (-not $pasta) { continue }",
    "$a = $w.CreateShortcut((Join-Path $pasta 'IA Editora de Video.lnk'))",
    `$a.TargetPath = ${aspas(node)}`,
    `$a.Arguments = ${aspas(`"${iniciar}"`)}`,
    `$a.WorkingDirectory = ${aspas(raiz)}`,
    `$a.IconLocation = ${aspas(icone)}`,
    "$a.Description = 'IA Editora de Video'",
    "$a.WindowStyle = 7",
    "$a.Save()",
    "}",
  ].join("\n");
}

export const MOTIVOS = { manual: "manual", automatica: "automática", "pre-migracao": "antes de atualizar o banco", "pre-restauracao": "antes de uma restauração", "pre-atualizacao": "antes de atualizar o programa" };
