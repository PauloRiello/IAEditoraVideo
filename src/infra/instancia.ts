// Instância em execução: a aplicação com interface registra aqui o processo, a porta e a
// sessão, para o inicializador abrir a janela e para outros comandos saberem que ela está
// aberta e não mexerem no trabalho em andamento.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const arquivoDeExecucao = (pastaDeDados: string): string => path.join(pastaDeDados, "execucao.json");

export function processoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    // EPERM: o processo existe, mas pertence a outro usuário.
    return (erro as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Há outra instância da aplicação aberta usando esta pasta de dados? */
export function outraInstanciaAtiva(pastaDeDados: string): boolean {
  try {
    const arquivo = arquivoDeExecucao(pastaDeDados);
    if (!existsSync(arquivo)) return false;
    const { pid } = JSON.parse(readFileSync(arquivo, "utf8")) as { pid: number };
    return Number.isInteger(pid) && pid !== process.pid && processoVivo(pid);
  } catch {
    return false;
  }
}
