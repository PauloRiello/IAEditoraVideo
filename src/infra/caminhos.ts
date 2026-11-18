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
  /** Ambiente da máquina (Python, FFmpeg, aceleração): fora da pasta do programa, que a atualização substitui. */
  ambiente: string;
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
export function montarCaminhos(dados: string, biblioteca: string, programa = PROGRAMA, ambiente = path.join(dados, "ambiente")): Caminhos {
  return {
    programa,
    perfis: path.join(programa, "IA", "Perfis"),
    dados,
    ambiente,
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
  const dados = ambiente.IAEV_DADOS ?? registrada.dados ?? dadosPadrao;
  return montarCaminhos(dados, ambiente.IAEV_BIBLIOTECA ?? registrada.biblioteca ?? bibliotecaPadrao, PROGRAMA, ambiente.IAEV_AMBIENTE ?? path.join(dados, "ambiente"));
}

/** Resultado da detecção de placa de vídeo. Instalações antigas o gravaram na pasta do programa. */
export function caminhoDaAceleracao(c: Caminhos): string {
  const novo = path.join(c.ambiente, "aceleracao.json");
  const antigo = path.join(c.programa, "config", "local.aceleracao.json");
  return !existsSync(novo) && existsSync(antigo) ? antigo : novo;
}

const pythonDoVenv = (venv: string): string =>
  process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");

/** Python com o Whisper: o do ambiente da máquina e, se não houver, o .venv de instalações antigas. */
export function pythonDoAmbiente(c: Caminhos): string | null {
  for (const venv of [path.join(c.ambiente, "python"), path.join(c.programa, ".venv")]) {
    if (existsSync(pythonDoVenv(venv))) return pythonDoVenv(venv);
  }
  return null;
}

/** Cria as pastas que faltam. Nunca apaga nem altera o que já existe. */
export function garantirPastas(c: Caminhos): void {
  const pastas = [
    path.dirname(c.banco), path.dirname(c.configuracoes), c.projetos, c.temporarios,
    c.backups, c.modelos, c.analises, c.registros, c.brutos, c.referencias, c.exportacoes,
  ];
  for (const pasta of pastas) mkdirSync(pasta, { recursive: true });
}
