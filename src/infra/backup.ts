// Cópias de segurança: criação, listagem, validação, restauração e rotação.
// Cada cópia é uma pasta com o banco e o arquivo de configurações.

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { copiarBanco, VERSAO_ESQUEMA, type Banco } from "./banco.ts";
import type { Caminhos } from "./caminhos.ts";

const ARQUIVO_BANCO = "editora.db";
const ARQUIVO_CONFIGURACOES = "configuracoes.json";
const MOTIVOS = ["manual", "automatica", "pre-migracao", "pre-restauracao", "pre-atualizacao"] as const;
/** Pastas de dados com personalizações do usuário (pequenos arquivos JSON), copiadas junto com o banco. */
const PASTAS_DO_USUARIO = ["perfis", "estilos", "qualidade", "presets", "marcas"];

export type MotivoCopia = (typeof MOTIVOS)[number];

export interface Copia {
  nome: string;
  pasta: string;
  motivo: MotivoCopia;
  criadaEm: string;
}

const carimbo = (): string => new Date().toISOString().replace(/[:.]/g, "-");

function interpretar(pastaBackups: string, nome: string): Copia | null {
  const partes = /^(\d{4}-\d\d-\d\dT)(\d\d)-(\d\d)-(\d\d)-(\d{3}Z)_([a-z-]+?)(-\d+)?$/.exec(nome);
  if (!partes || !MOTIVOS.includes(partes[6] as MotivoCopia)) return null;
  const pasta = path.join(pastaBackups, nome);
  if (!existsSync(path.join(pasta, ARQUIVO_BANCO))) return null;
  return {
    nome,
    pasta,
    motivo: partes[6] as MotivoCopia,
    criadaEm: `${partes[1]}${partes[2]}:${partes[3]}:${partes[4]}.${partes[5]}`,
  };
}

/** Cria uma cópia do banco (íntegra mesmo com a aplicação em uso) e das configurações. */
export function criarCopia(banco: Banco, caminhos: Caminhos, motivo: MotivoCopia): Copia {
  const base = `${carimbo()}_${motivo}`;
  let nome = base;
  for (let i = 2; existsSync(path.join(caminhos.backups, nome)); i += 1) nome = `${base}-${i}`;
  const pasta = path.join(caminhos.backups, nome);
  mkdirSync(pasta, { recursive: true });
  copiarBanco(banco, path.join(pasta, ARQUIVO_BANCO));
  if (existsSync(caminhos.configuracoes)) copyFileSync(caminhos.configuracoes, path.join(pasta, ARQUIVO_CONFIGURACOES));
  // Perfis, estilos, destinos e presets criados pelo usuário. As chaves de API não entram na cópia.
  for (const nomeDaPasta of PASTAS_DO_USUARIO) {
    const origem = path.join(caminhos.dados, nomeDaPasta);
    if (existsSync(origem)) cpSync(origem, path.join(pasta, nomeDaPasta), { recursive: true });
  }
  return interpretar(caminhos.backups, nome) as Copia;
}

/** Cópias existentes, da mais recente para a mais antiga. */
export function listarCopias(caminhos: Caminhos): Copia[] {
  if (!existsSync(caminhos.backups)) return [];
  return readdirSync(caminhos.backups)
    .map((nome) => interpretar(caminhos.backups, nome))
    .filter((copia): copia is Copia => copia !== null)
    .sort((a, b) => b.nome.localeCompare(a.nome));
}

/** Lança erro se a cópia estiver danificada ou tiver sido criada por um programa mais novo. */
export function validarCopia(copia: Copia): void {
  const banco = new DatabaseSync(path.join(copia.pasta, ARQUIVO_BANCO));
  try {
    const exame = banco.prepare("PRAGMA quick_check").get() as { quick_check: string };
    if (exame.quick_check !== "ok") throw new Error(`Cópia ${copia.nome} está danificada.`);
    const versao = (banco.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (versao > VERSAO_ESQUEMA) throw new Error(`Cópia ${copia.nome} é de uma versão mais nova do programa.`);
  } finally {
    banco.close();
  }
}

export function copiaValida(copia: Copia): boolean {
  try {
    validarCopia(copia);
    return true;
  } catch {
    return false;
  }
}

function removerBanco(arquivo: string): void {
  for (const sufixo of ["", "-wal", "-shm"]) rmSync(`${arquivo}${sufixo}`, { force: true });
}

/** Põe os arquivos da cópia no lugar dos atuais. O banco precisa estar fechado. */
export function restaurarArquivos(caminhos: Caminhos, copia: Copia, incluirConfiguracoes: boolean): void {
  removerBanco(caminhos.banco);
  copyFileSync(path.join(copia.pasta, ARQUIVO_BANCO), caminhos.banco);
  const configuracoes = path.join(copia.pasta, ARQUIVO_CONFIGURACOES);
  if (!incluirConfiguracoes) return;
  if (existsSync(configuracoes)) copyFileSync(configuracoes, caminhos.configuracoes);
  for (const nomeDaPasta of PASTAS_DO_USUARIO) {
    const origem = path.join(copia.pasta, nomeDaPasta);
    if (existsSync(origem)) cpSync(origem, path.join(caminhos.dados, nomeDaPasta), { recursive: true });
  }
}

/** Mantém só as `manter` cópias automáticas mais recentes. As demais (manuais e de proteção) nunca são apagadas. */
export function rotacionar(caminhos: Caminhos, manter: number): number {
  const excedentes = listarCopias(caminhos).filter((c) => c.motivo === "automatica").slice(Math.max(0, manter));
  for (const copia of excedentes) rmSync(copia.pasta, { recursive: true, force: true });
  return excedentes.length;
}

/** Afasta um arquivo danificado, sem apagá-lo, para permitir análise posterior. Devolve o novo caminho. */
export function isolarArquivo(arquivo: string): string {
  const destino = `${arquivo}.corrompido-${carimbo()}`;
  renameSync(arquivo, destino);
  if (arquivo.endsWith(".db")) for (const sufixo of ["-wal", "-shm"]) rmSync(`${arquivo}${sufixo}`, { force: true });
  return destino;
}
