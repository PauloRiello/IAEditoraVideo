// Banco de dados SQLite (módulo nativo do Node.js, sem dependências externas).
// Único arquivo do projeto que conhece o esquema físico das tabelas.
// O banco guarda caminhos, metadados e resultados; nunca o conteúdo de vídeos.

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Banco = DatabaseSync;

/** O arquivo existe, mas não é um banco íntegro. */
export class BancoCorrompido extends Error {
  constructor(arquivo: string, detalhe: string) {
    super(`Banco de dados corrompido em ${arquivo}: ${detalhe}`);
    this.name = "BancoCorrompido";
  }
}

/**
 * Migrações em ordem. Cada posição leva o banco à versão seguinte.
 * Regra: nunca editar uma migração publicada; acrescentar uma nova ao final.
 * É isso que preserva os dados do usuário quando o programa é atualizado.
 */
export const MIGRACOES: string[] = [
  // v1 — projetos, mídias, execuções do pipeline, preferências e feedback
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
  // v2 — referências, análises, planos versionados, aprendizados com evidências e uso de IA
  `
  CREATE TABLE referencias (
    id TEXT PRIMARY KEY,
    titulo TEXT NOT NULL,
    caminho TEXT,
    origem_url TEXT,
    perfil TEXT,
    autorizacao TEXT NOT NULL DEFAULT '',
    notas TEXT NOT NULL DEFAULT '',
    criado_em TEXT NOT NULL,
    CHECK (caminho IS NOT NULL OR origem_url IS NOT NULL)
  );
  CREATE TABLE projeto_referencias (
    projeto_id TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
    referencia_id TEXT NOT NULL REFERENCES referencias(id) ON DELETE CASCADE,
    PRIMARY KEY (projeto_id, referencia_id)
  );
  CREATE TABLE analises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    midia_id TEXT REFERENCES midias(id) ON DELETE CASCADE,
    referencia_id TEXT REFERENCES referencias(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL,
    resultado TEXT NOT NULL,
    criado_em TEXT NOT NULL,
    CHECK ((midia_id IS NULL) <> (referencia_id IS NULL))
  );
  CREATE INDEX analises_midia ON analises (midia_id, tipo, id);
  CREATE INDEX analises_referencia ON analises (referencia_id, tipo, id);
  CREATE TABLE planos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projeto_id TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
    versao INTEGER NOT NULL,
    plano TEXT NOT NULL,
    autor TEXT NOT NULL CHECK (autor IN ('ia', 'usuario')),
    nota TEXT NOT NULL DEFAULT '',
    criado_em TEXT NOT NULL,
    UNIQUE (projeto_id, versao)
  );
  CREATE TABLE aprendizados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    escopo TEXT NOT NULL CHECK (escopo IN ('geral', 'especializacao', 'projeto', 'temporaria')),
    perfil TEXT,
    projeto_id TEXT REFERENCES projetos(id) ON DELETE CASCADE,
    categoria TEXT NOT NULL,
    chave TEXT NOT NULL,
    descricao TEXT NOT NULL,
    valor TEXT NOT NULL DEFAULT 'null',
    contexto TEXT NOT NULL DEFAULT '',
    estado TEXT NOT NULL CHECK (estado IN ('candidato', 'ativo', 'desativado')),
    confianca REAL NOT NULL DEFAULT 0,
    evidencias INTEGER NOT NULL DEFAULT 0,
    contrarias INTEGER NOT NULL DEFAULT 0,
    projetos_observados INTEGER NOT NULL DEFAULT 0,
    expira_em TEXT,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL,
    CHECK (escopo <> 'especializacao' OR perfil IS NOT NULL),
    CHECK (escopo <> 'projeto' OR projeto_id IS NOT NULL)
  );
  CREATE UNIQUE INDEX aprendizados_identidade
    ON aprendizados (escopo, COALESCE(perfil, ''), COALESCE(projeto_id, ''), categoria, chave, valor);
  CREATE TABLE evidencias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    aprendizado_id INTEGER NOT NULL REFERENCES aprendizados(id) ON DELETE CASCADE,
    origem TEXT NOT NULL CHECK (origem IN ('feedback', 'analise', 'correcao', 'usuario')),
    projeto_id TEXT REFERENCES projetos(id) ON DELETE SET NULL,
    feedback_id INTEGER REFERENCES feedback(id) ON DELETE SET NULL,
    detalhe TEXT NOT NULL DEFAULT '',
    confirma INTEGER NOT NULL CHECK (confirma IN (0, 1)),
    peso REAL NOT NULL,
    criado_em TEXT NOT NULL
  );
  CREATE INDEX evidencias_aprendizado ON evidencias (aprendizado_id);
  CREATE TABLE usos_ia (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projeto_id TEXT REFERENCES projetos(id) ON DELETE SET NULL,
    provedor TEXT NOT NULL,
    modelo TEXT NOT NULL,
    origem TEXT NOT NULL CHECK (origem IN ('local', 'externo')),
    capacidade TEXT NOT NULL,
    operacao TEXT NOT NULL,
    dispositivo TEXT CHECK (dispositivo IN ('gpu', 'cpu')),
    duracao_ms INTEGER,
    sucesso INTEGER NOT NULL CHECK (sucesso IN (0, 1)),
    criado_em TEXT NOT NULL
  );
  `,
  // v3 — evidências vindas da análise de referências
  `
  ALTER TABLE evidencias ADD COLUMN referencia_id TEXT REFERENCES referencias(id) ON DELETE SET NULL;
  CREATE INDEX evidencias_referencia ON evidencias (referencia_id);
  `,
  // v4 — aprovação de planos, registro de decisões e índice de pesquisa dos vídeos brutos
  `
  ALTER TABLE planos ADD COLUMN estado TEXT NOT NULL DEFAULT 'rascunho' CHECK (estado IN ('rascunho', 'aprovado', 'rejeitado'));
  ALTER TABLE planos ADD COLUMN decidido_em TEXT;
  CREATE TABLE decisoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projeto_id TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
    versao_do_plano INTEGER,
    tipo TEXT NOT NULL CHECK (tipo IN ('plano-gerado', 'alteracao', 'aprovacao', 'rejeicao', 'roteiro')),
    descricao TEXT NOT NULL,
    criado_em TEXT NOT NULL
  );
  CREATE TABLE indice (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    midia_id TEXT NOT NULL REFERENCES midias(id) ON DELETE CASCADE,
    projeto_id TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL,
    inicio_seg REAL NOT NULL,
    fim_seg REAL NOT NULL,
    texto TEXT NOT NULL,
    etiquetas TEXT NOT NULL,
    busca TEXT NOT NULL,
    pontuacao REAL NOT NULL DEFAULT 0
  );
  CREATE INDEX indice_midia ON indice (midia_id);
  CREATE INDEX indice_projeto ON indice (projeto_id, tipo);
  `,
  // v5 — timelines versionadas e histórico de exportações
  `
  CREATE TABLE timelines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projeto_id TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
    versao INTEGER NOT NULL,
    timeline TEXT NOT NULL,
    autor TEXT NOT NULL CHECK (autor IN ('ia', 'usuario')),
    nota TEXT NOT NULL DEFAULT '',
    criado_em TEXT NOT NULL,
    UNIQUE (projeto_id, versao)
  );
  CREATE TABLE exportacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projeto_id TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
    versao_da_timeline INTEGER NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('previa', 'final')),
    estado TEXT NOT NULL CHECK (estado IN ('na-fila', 'renderizando', 'concluida', 'falhou', 'cancelada')),
    progresso REAL NOT NULL DEFAULT 0,
    arquivo TEXT,
    largura INTEGER,
    altura INTEGER,
    fps REAL,
    duracao_seg REAL,
    tamanho_bytes INTEGER,
    verificacao TEXT,
    erro TEXT,
    tentativas INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL,
    concluido_em TEXT
  );
  `,
  // v6 — avaliações de edições, trechos em revisão, métricas de resultado e ações reversíveis sobre aprendizados
  `
  CREATE TABLE avaliacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projeto_id TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
    versao_da_timeline INTEGER NOT NULL,
    exportacao_id INTEGER REFERENCES exportacoes(id) ON DELETE SET NULL,
    decisao TEXT NOT NULL CHECK (decisao IN ('aprovada', 'rejeitada', 'alteracoes-solicitadas')),
    motivo TEXT NOT NULL DEFAULT '',
    notas TEXT NOT NULL DEFAULT '{}',
    desfeita INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL
  );
  CREATE TABLE trechos_em_revisao (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    avaliacao_id INTEGER NOT NULL REFERENCES avaliacoes(id) ON DELETE CASCADE,
    projeto_id TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
    inicio_seg REAL NOT NULL,
    fim_seg REAL NOT NULL,
    item_id TEXT,
    aspecto TEXT,
    comentario TEXT NOT NULL DEFAULT '',
    resolvido INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE resultados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projeto_id TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
    exportacao_id INTEGER REFERENCES exportacoes(id) ON DELETE SET NULL,
    plataforma TEXT NOT NULL,
    metricas TEXT NOT NULL,
    evidencia_de_atribuicao TEXT NOT NULL DEFAULT '',
    observacoes TEXT NOT NULL DEFAULT '',
    leitura TEXT NOT NULL,
    criado_em TEXT NOT NULL
  );
  CREATE TABLE acoes_de_aprendizado (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    aprendizado_id INTEGER NOT NULL,
    acao TEXT NOT NULL CHECK (acao IN ('corrigido', 'desativado', 'ativado', 'excluido')),
    descricao TEXT NOT NULL,
    estado_anterior TEXT NOT NULL,
    desfeita INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL
  );
  ALTER TABLE evidencias ADD COLUMN avaliacao_id INTEGER REFERENCES avaliacoes(id) ON DELETE SET NULL;
  ALTER TABLE evidencias ADD COLUMN resultado_id INTEGER REFERENCES resultados(id) ON DELETE SET NULL;
  CREATE INDEX evidencias_avaliacao ON evidencias (avaliacao_id);
  CREATE INDEX evidencias_resultado ON evidencias (resultado_id);
  `,
  // v7 — relatórios de controle de qualidade e preset usado em cada exportação
  `
  CREATE TABLE relatorios_de_qualidade (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projeto_id TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
    versao_da_timeline INTEGER NOT NULL,
    exportacao_id INTEGER REFERENCES exportacoes(id) ON DELETE SET NULL,
    arquivo TEXT,
    perfil_de_qualidade TEXT NOT NULL,
    situacao TEXT NOT NULL CHECK (situacao IN ('aprovado', 'aprovado-com-ressalvas', 'pendente', 'reprovado')),
    verificacoes TEXT NOT NULL,
    excecoes TEXT NOT NULL DEFAULT '[]',
    criado_em TEXT NOT NULL
  );
  CREATE INDEX relatorios_exportacao ON relatorios_de_qualidade (exportacao_id);
  ALTER TABLE exportacoes ADD COLUMN preset TEXT;
  `,
  // v8 — configuração de cada projeto (objetivo, público, formato, estilo, nível de automação) e histórico de atividades
  `
  ALTER TABLE projetos ADD COLUMN configuracao TEXT NOT NULL DEFAULT '{}';
  CREATE TABLE atividades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projeto_id TEXT REFERENCES projetos(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL,
    descricao TEXT NOT NULL,
    criado_em TEXT NOT NULL
  );
  CREATE INDEX atividades_projeto ON atividades (projeto_id, id);
  `,
];

export const VERSAO_ESQUEMA = MIGRACOES.length;

export function versaoDoBanco(banco: Banco): number {
  return (banco.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
}

/** Executa a função dentro de uma transação: ou tudo é gravado, ou nada. */
export function transacao<T>(banco: Banco, funcao: () => T): T {
  banco.exec("BEGIN IMMEDIATE");
  try {
    const resultado = funcao();
    banco.exec("COMMIT");
    return resultado;
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  }
}

export interface OpcoesBanco {
  /** Chamada uma vez antes de migrar um banco que já tem dados (para criar uma cópia de segurança). */
  antesDeMigrar?: (banco: Banco, versao: number) => void;
}

/**
 * Abre (ou cria) o banco, confere a integridade e aplica as migrações pendentes.
 * Cada gravação é confirmada em disco na hora (salvamento automático): o modo WAL com
 * synchronous = FULL garante que uma queda de energia não deixa o banco pela metade.
 */
export function abrirBanco(arquivo: string, opcoes: OpcoesBanco = {}): Banco {
  mkdirSync(path.dirname(arquivo), { recursive: true });
  let banco: Banco | undefined;
  try {
    banco = new DatabaseSync(arquivo);
    banco.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;");
    const exame = banco.prepare("PRAGMA quick_check").get() as { quick_check: string };
    if (exame.quick_check !== "ok") throw new Error(exame.quick_check);
  } catch (erro) {
    try {
      banco?.close();
    } catch {
      // já estava fechado
    }
    throw new BancoCorrompido(arquivo, erro instanceof Error ? erro.message : String(erro));
  }

  const versao = versaoDoBanco(banco);
  if (versao > VERSAO_ESQUEMA) {
    banco.close();
    throw new Error(`Banco na versão ${versao}, mais nova que este programa (${VERSAO_ESQUEMA}). Atualize o programa.`);
  }
  if (versao > 0 && versao < VERSAO_ESQUEMA) opcoes.antesDeMigrar?.(banco, versao);

  for (let i = versao; i < VERSAO_ESQUEMA; i += 1) {
    try {
      transacao(banco, () => {
        banco.exec(MIGRACOES[i]);
        banco.exec(`PRAGMA user_version = ${i + 1}`);
      });
    } catch (erro) {
      banco.close();
      throw erro;
    }
  }
  return banco;
}

/** Grava uma cópia íntegra do banco em outro arquivo, mesmo com a aplicação em uso. */
export function copiarBanco(banco: Banco, destino: string): void {
  mkdirSync(path.dirname(destino), { recursive: true });
  banco.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
}

export const agora = (): string => new Date().toISOString();
