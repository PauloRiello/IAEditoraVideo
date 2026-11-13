// Transcrição local com Whisper (faster-whisper), executado como processo Python separado.

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Transcricao } from "../../src/dominio/analise.ts";
import { executar } from "../analysis/ferramentas.ts";

/** VRAM aproximada exigida por cada modelo, em MB. */
export const VRAM_POR_MODELO: Record<string, number> = { tiny: 1000, base: 1000, small: 2000, medium: 5000, "large-v3": 10000, turbo: 6000 };

export interface OpcoesWhisper {
  /** Interpretador Python com o faster-whisper instalado. */
  python: string;
  modelo: string;
  dispositivo: "cuda" | "cpu";
  /** Código do idioma, ou vazio para detectar. */
  idioma: string;
  /** Onde os modelos baixados ficam guardados. */
  pastaDeModelos: string;
}

/** Python do ambiente virtual do projeto, ou null se não existir. */
export function pythonDoPrograma(programa: string): string | null {
  const caminho = process.platform === "win32" ? path.join(programa, ".venv", "Scripts", "python.exe") : path.join(programa, ".venv", "bin", "python");
  return existsSync(caminho) ? caminho : null;
}

/** Transcreve a fala de um arquivo. Lança erro se o Whisper não puder ser executado. */
export async function transcrever(arquivo: string, opcoes: OpcoesWhisper): Promise<Transcricao> {
  const roteiro = path.join(path.dirname(fileURLToPath(import.meta.url)), "transcrever.py");
  const saida = await executar(opcoes.python, [
    roteiro, arquivo, opcoes.modelo, opcoes.dispositivo,
    opcoes.dispositivo === "cuda" ? "float16" : "int8", opcoes.idioma, opcoes.pastaDeModelos,
  ]);
  return JSON.parse(saida.toString("utf8").trim().split(/\r?\n/).pop() as string) as Transcricao;
}
