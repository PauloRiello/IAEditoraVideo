// Preparação do computador pela linha de comando ou pelo aplicativo. Fala em linhas JSON:
// {"etapa", "fracao"} durante o trabalho e, no fim, {"pronto", "faltando", "avisos"} ou
// {"erro"}. Não carrega o Remotion nem abre o banco: só prepara o ambiente.
// Uso: node src/interface/preparar.ts

import { fileURLToPath } from "node:url";
import { caminhosPadrao } from "../infra/caminhos.ts";
import { prepararAmbiente, type ResultadoDaPreparacao } from "../servicos/ambiente.ts";

type Preparacao = (aoProgredir: (etapa: string, fracao: number) => void) => Promise<ResultadoDaPreparacao>;

/** Traduz a preparação em linhas JSON. Devolve false se terminou com erro. */
export async function prepararEmLinhas(preparar: Preparacao, escrever: (linha: string) => void): Promise<boolean> {
  try {
    const r = await preparar((etapa, fracao) => escrever(JSON.stringify({ etapa, fracao })));
    escrever(JSON.stringify({ pronto: true, faltando: r.faltando, avisos: r.avisos }));
    return true;
  } catch (erro) {
    escrever(JSON.stringify({ erro: erro instanceof Error ? erro.message : String(erro) }));
    return false;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const caminhos = caminhosPadrao();
  const ok = await prepararEmLinhas((aoProgredir) => prepararAmbiente({ caminhos, aoProgredir }), (linha) => process.stdout.write(`${linha}\n`));
  process.exitCode = ok ? 0 : 1;
}
