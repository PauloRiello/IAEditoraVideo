// Ponto de entrada da aplicação com interface gráfica: abre a Aplicacao, inicia o servidor
// local e registra onde ele está, para o inicializador abrir a janela e para o comando de
// parar encontrá-lo. Não depende de nenhum outro programa em execução.
// Uso normal: scripts/iniciar.mjs (ou o atalho criado pelo instalador).
//
// Modo anfitrião (IAEV_ANFITRIAO=1), usado pelo aplicativo: a saída padrão passa a ter só
// linhas JSON ({"etapa", "fracao"}, depois {"pronta", "porta", "token", "avisos"} ou
// {"erro"}); o registro vai para IAEV_REGISTRO ou para a saída de erros; e a aplicação
// encerra quando a entrada padrão fecha, isto é, quando o aplicativo fechou.

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { caminhosPadrao } from "../infra/caminhos.ts";
import { arquivoDeExecucao as arquivoDaInstancia } from "../infra/instancia.ts";
import { Aplicacao } from "../nucleo/aplicacao.ts";
import { iniciarServidor } from "./servidor.ts";

const anfitriao = process.env.IAEV_ANFITRIAO === "1";
/** Linha para o aplicativo (só no modo anfitrião). */
const anunciar = (mensagem: Record<string, unknown>) => {
  if (anfitriao) process.stdout.write(`${JSON.stringify(mensagem)}\n`);
};

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
} else if (anfitriao) {
  // A saída padrão é do aplicativo: o registro vai para a saída de erros.
  console.log = (...partes: unknown[]) => console.error(...partes);
}

const caminhos = caminhosPadrao();
const arquivoDeExecucao = arquivoDaInstancia(caminhos.dados);
const agora = () => new Date().toISOString();

/** Outra instância já está atendendo? Duas ao mesmo tempo disputariam o banco e os renders. */
async function jaAberta(): Promise<{ porta: number; token: string } | null> {
  try {
    if (!existsSync(arquivoDeExecucao)) return null;
    const execucao = JSON.parse(readFileSync(arquivoDeExecucao, "utf8")) as { porta: number; token: string };
    const resposta = await fetch(`http://127.0.0.1:${execucao.porta}/api/saude`, { signal: AbortSignal.timeout(1500) });
    return resposta.ok && ((await resposta.json()) as { aplicacao?: string }).aplicacao === "ia-editora-video" ? execucao : null;
  } catch {
    return null;
  }
}

const aberta = await jaAberta();
if (aberta) {
  console.log(`${agora()} A IA Editora de Vídeo já está aberta.`);
  // O aplicativo mostra a que já está aberta (por exemplo, iniciada pelo atalho antigo).
  anunciar({ pronta: true, porta: aberta.porta, token: aberta.token, avisos: [], jaAberta: true });
  process.exit(0);
}

function avisosDaPreparacao(): string[] {
  try {
    const avisos: unknown = JSON.parse(process.env.IAEV_AVISOS_DA_PREPARACAO ?? "[]");
    return Array.isArray(avisos) ? avisos.map(String) : [];
  } catch {
    return [];
  }
}

let app: Aplicacao;
let servidor: Awaited<ReturnType<typeof iniciarServidor>>;
try {
  anunciar({ etapa: "Abrindo os dados", fracao: 0.2 });
  app = new Aplicacao(caminhos);
  // O que a preparação do computador não conseguiu fazer aparece no painel, com o que fazer.
  for (const aviso of avisosDaPreparacao()) app.avisos.push(`${aviso} Feche e abra o programa de novo, com internet, para terminar a preparação.`);
  anunciar({ etapa: "Ligando o servidor", fracao: 0.8 });
  servidor = await abrirServidor(app);
} catch (erro) {
  console.error(`${agora()} Erro ao abrir a aplicação: ${erro instanceof Error ? (erro.stack ?? erro.message) : String(erro)}`);
  anunciar({ erro: erro instanceof Error ? erro.message : String(erro) });
  process.exit(1);
}

function abrirServidor(aplicacao: Aplicacao) {
  return iniciarServidor(aplicacao, {
  porta: process.env.IAEV_PORTA ? Number(process.env.IAEV_PORTA) : undefined,
  // No modo anfitrião, quem decide o fim é o aplicativo (pela entrada padrão), não a janela.
  encerrarSemJanela: !anfitriao && process.env.IAEV_MANTER_ABERTA !== "1",
  esperaSemJanelaSeg: process.env.IAEV_ESPERA_SEM_JANELA ? Number(process.env.IAEV_ESPERA_SEM_JANELA) : undefined,
  aoEncerrar: () => {
    rmSync(arquivoDeExecucao, { force: true });
    console.log(`${agora()} Aplicação encerrada.`);
    process.exit(0);
  },
  });
}

// O segredo da sessão fica só neste arquivo, na pasta de dados do usuário; não vai para o registro.
mkdirSync(path.dirname(arquivoDeExecucao), { recursive: true });
writeFileSync(arquivoDeExecucao, `${JSON.stringify({ pid: process.pid, porta: servidor.porta, token: servidor.token, iniciadoEm: agora() })}\n`, { mode: 0o600 });
console.log(`${agora()} IA Editora de Vídeo ${app.versao()} pronta em http://127.0.0.1:${servidor.porta} (processo ${process.pid}).`);
for (const aviso of app.avisos) console.log(`${agora()} Aviso: ${aviso}`);
anunciar({ pronta: true, porta: servidor.porta, token: servidor.token, avisos: app.avisos });
if (anfitriao) {
  process.stdin.on("end", () => void servidor.encerrar());
  process.stdin.on("error", () => void servidor.encerrar());
  process.stdin.resume();
}

for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sinal, () => void servidor.encerrar());
process.on("uncaughtException", (erro) => console.error(`${agora()} Erro inesperado: ${erro.stack ?? erro.message}`));
process.on("unhandledRejection", (erro) => console.error(`${agora()} Erro inesperado: ${erro instanceof Error ? (erro.stack ?? erro.message) : String(erro)}`));
