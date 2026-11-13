// Banco de dados SQLite (módulo nativo do Node.js, sem dependências externas).
// Único arquivo do projeto que conhece o esquema físico das tabelas.

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Banco = DatabaseSync;

/**
 * Migrações em ordem. Cada posição leva o banco à versão seguinte.
 * Regra: nunca editar uma migração publicada; acrescentar uma nova ao final.
 * É isso que preserva os dados do usuário quando o programa é atualizado.
 */
const MIGRACOES: string[] = [
  `
  CREATE TABLE projetos (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    perfil TEXT NOT NULL,
    formato TEXT NOT NULL,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL
  );
  CREATE TABLE midias (
    id TEXT PRIMARY KEY,
    projeto_id TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('bruto', 'referencia', 'exportacao')),
    caminho TEXT NOT NULL,
    metadados TEXT,
    criado_em TEXT NOT NULL
  );
  CREATE TABLE execucoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projeto_id TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
    etapa TEXT NOT NULL,
    estado TEXT NOT NULL CHECK (estado IN ('executando', 'concluida', 'falhou')),
    resultado TEXT,
    erro TEXT,
    iniciado_em TEXT NOT NULL,
    concluido_em TEXT
  );
  CREATE INDEX execucoes_projeto ON execucoes (projeto_id, etapa, id);
  CREATE TABLE memoria (
    escopo TEXT NOT NULL,
    chave TEXT NOT NULL,
    valor TEXT NOT NULL,
    atualizado_em TEXT NOT NULL,
    PRIMARY KEY (escopo, chave)
  );
  CREATE TABLE feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projeto_id TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
    nota INTEGER NOT NULL CHECK (nota BETWEEN 1 AND 5),
    comentario TEXT NOT NULL,
    criado_em TEXT NOT NULL
  );
  `,
];

export const VERSAO_ESQUEMA = MIGRACOES.length;

function versaoAtual(banco: Banco): number {
  return (banco.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
}

/** Abre (ou cria) o banco e aplica as migrações pendentes. */
export function abrirBanco(arquivo: string): Banco {
  mkdirSync(path.dirname(arquivo), { recursive: true });
  const banco = new DatabaseSync(arquivo);
  banco.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

  const versao = versaoAtual(banco);
  if (versao > VERSAO_ESQUEMA) {
    banco.close();
    throw new Error(`Banco na versão ${versao}, mais nova que este programa (${VERSAO_ESQUEMA}). Atualize o programa.`);
  }
  for (let i = versao; i < VERSAO_ESQUEMA; i += 1) {
    banco.exec("BEGIN");
    try {
      banco.exec(MIGRACOES[i]);
      banco.exec(`PRAGMA user_version = ${i + 1}`);
      banco.exec("COMMIT");
    } catch (erro) {
      banco.exec("ROLLBACK");
      banco.close();
      throw erro;
    }
  }
  return banco;
}

/** Grava uma cópia íntegra do banco em outro arquivo, mesmo com a aplicação em uso. */
export function copiarBanco(banco: Banco, destino: string): void {
  if (existsSync(destino)) throw new Error(`Já existe um arquivo em ${destino}.`);
  mkdirSync(path.dirname(destino), { recursive: true });
  banco.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
}

export const agora = (): string => new Date().toISOString();
