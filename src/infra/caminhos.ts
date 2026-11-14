// Onde cada tipo de arquivo fica. Código, dados da aplicação e mídias do usuário são separados.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Caminhos {
  /** Pasta do programa (somente leitura depois de instalado). */
  programa: string;
  /** Perfis de especialização que acompanham o programa. */
  perfis: string;
  /** Dados da aplicação: sobrevivem a atualizações do programa. */
  dados: string;
  banco: string;
  configuracoes: string;
  projetos: string;
  temporarios: string;
  backups: string;
  modelos: string;
  /** Relatórios e quadros gerados pela análise de referências. */
  analises: string;
  registros: string;
  /** Mídias do usuário. */
  brutos: string;
  referencias: string;
  exportacoes: string;
}

const PROGRAMA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Monta os caminhos a partir da pasta de dados e da pasta de mídias. */
export function montarCaminhos(dados: string, biblioteca: string, programa = PROGRAMA): Caminhos {
  return {
    programa,
    perfis: path.join(programa, "IA", "Perfis"),
    dados,
    banco: path.join(dados, "banco", "editora.db"),
    configuracoes: path.join(dados, "config", "configuracoes.json"),
    projetos: path.join(dados, "projetos"),
    temporarios: path.join(dados, "temp"),
    backups: path.join(dados, "backups"),
    modelos: path.join(dados, "modelos"),
    analises: path.join(dados, "analises"),
    registros: path.join(dados, "logs"),
    brutos: path.join(biblioteca, "Videos Brutos"),
    referencias: path.join(biblioteca, "Referências"),
    exportacoes: path.join(biblioteca, "Exportações"),
  };
}

/** Arquivo gravado pelo instalador com as pastas escolhidas pelo usuário. Fica fora do Git. */
export const arquivoDaInstalacao = (programa = PROGRAMA): string => path.join(programa, "config", "local.instalacao.json");

/** Pastas escolhidas na instalação, se a aplicação foi instalada pelo instalador. */
export function instalacaoRegistrada(programa = PROGRAMA): { dados?: string; biblioteca?: string } {
  try {
    return existsSync(arquivoDaInstalacao(programa)) ? (JSON.parse(readFileSync(arquivoDaInstalacao(programa), "utf8")) as { dados?: string; biblioteca?: string }) : {};
  } catch {
    return {};
  }
}

/**
 * Caminhos padrão, nesta ordem de prioridade:
 * 1. As variáveis IAEV_DADOS e IAEV_BIBLIOTECA.
 * 2. As pastas gravadas pelo instalador em config/local.instalacao.json.
 * 3. Instalado (IAEV_INSTALADO=1): dados em %LOCALAPPDATA% e mídias em Documentos.
 * 4. Desenvolvimento: tudo dentro do repositório (dados em Dados/, fora do Git).
 */
export function caminhosPadrao(ambiente: NodeJS.ProcessEnv = process.env): Caminhos {
  const instalado = ambiente.IAEV_INSTALADO === "1";
  const registrada = instalacaoRegistrada();
  const dadosPadrao = instalado
    ? path.join(ambiente.LOCALAPPDATA ?? path.join(os.homedir(), ".local", "share"), "IAEditoraVideo")
    : path.join(PROGRAMA, "Dados");
  const bibliotecaPadrao = instalado ? path.join(os.homedir(), "Documents", "IA Editora de Vídeo") : PROGRAMA;
  return montarCaminhos(ambiente.IAEV_DADOS ?? registrada.dados ?? dadosPadrao, ambiente.IAEV_BIBLIOTECA ?? registrada.biblioteca ?? bibliotecaPadrao);
}

/** Cria as pastas que faltam. Nunca apaga nem altera o que já existe. */
export function garantirPastas(c: Caminhos): void {
  const pastas = [
    path.dirname(c.banco), path.dirname(c.configuracoes), c.projetos, c.temporarios,
    c.backups, c.modelos, c.analises, c.registros, c.brutos, c.referencias, c.exportacoes,
  ];
  for (const pasta of pastas) mkdirSync(pasta, { recursive: true });
}
