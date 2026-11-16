// Ponto de entrada da aplicação com interface gráfica: abre a Aplicacao, inicia o servidor
// local e registra onde ele está, para o inicializador abrir a janela e para o comando de
// parar encontrá-lo. Não depende de nenhum outro programa em execução.
// Uso normal: scripts/iniciar.mjs (ou o atalho criado pelo instalador).

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { caminhosPadrao } from "../infra/caminhos.ts";
import { arquivoDeExecucao as arquivoDaInstancia } from "../infra/instancia.ts";
import { Aplicacao } from "../nucleo/aplicacao.ts";
import { iniciarServidor } from "./servidor.ts";

// Sem saída redirecionada (no Windows, a aplicação roda com console invisível), o registro é gravado aqui.
if (process.env.IAEV_REGISTRO) {
  const arquivo = process.env.IAEV_REGISTRO;
  const gravar = (...partes: unknown[]) => {
    try {
      appendFileSync(arquivo, `${partes.map((p) => (p instanceof Error ? (p.stack ?? p.message) : String(p))).join(" ")}\n`);
    } catch {
      // sem onde registrar: segue sem registro
    }
  };
  console.log = gravar;
  console.error = gravar;
}

const caminhos = caminhosPadrao();
const arquivoDeExecucao = arquivoDaInstancia(caminhos.dados);
const agora = () => new Date().toISOString();

/** Outra instância já está atendendo? Duas ao mesmo tempo disputariam o banco e os renders. */
async function jaAberta(): Promise<boolean> {
  try {
    if (!existsSync(arquivoDeExecucao)) return false;
    const { porta } = JSON.parse(readFileSync(arquivoDeExecucao, "utf8")) as { porta: number };
    const resposta = await fetch(`http://127.0.0.1:${porta}/api/saude`, { signal: AbortSignal.timeout(1500) });
    return resposta.ok && ((await resposta.json()) as { aplicacao?: string }).aplicacao === "ia-editora-video";
  } catch {
    return false;
  }
}

if (await jaAberta()) {
  console.log(`${agora()} A IA Editora de Vídeo já está aberta.`);
  process.exit(0);
}

const app = new Aplicacao(caminhos);
const servidor = await iniciarServidor(app, {
  porta: process.env.IAEV_PORTA ? Number(process.env.IAEV_PORTA) : undefined,
  encerrarSemJanela: process.env.IAEV_MANTER_ABERTA !== "1",
  esperaSemJanelaSeg: process.env.IAEV_ESPERA_SEM_JANELA ? Number(process.env.IAEV_ESPERA_SEM_JANELA) : undefined,
  aoEncerrar: () => {
    rmSync(arquivoDeExecucao, { force: true });
    console.log(`${agora()} Aplicação encerrada.`);
    process.exit(0);
  },
});

// O segredo da sessão fica só neste arquivo, na pasta de dados do usuário; não vai para o registro.
mkdirSync(path.dirname(arquivoDeExecucao), { recursive: true });
writeFileSync(arquivoDeExecucao, `${JSON.stringify({ pid: process.pid, porta: servidor.porta, token: servidor.token, iniciadoEm: agora() })}\n`, { mode: 0o600 });
console.log(`${agora()} IA Editora de Vídeo ${app.versao()} pronta em http://127.0.0.1:${servidor.porta} (processo ${process.pid}).`);
for (const aviso of app.avisos) console.log(`${agora()} Aviso: ${aviso}`);

for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sinal, () => void servidor.encerrar());
process.on("uncaughtException", (erro) => console.error(`${agora()} Erro inesperado: ${erro.stack ?? erro.message}`));
process.on("unhandledRejection", (erro) => console.error(`${agora()} Erro inesperado: ${erro instanceof Error ? (erro.stack ?? erro.message) : String(erro)}`));
