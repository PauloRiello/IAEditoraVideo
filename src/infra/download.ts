// Download de arquivos grandes: tamanho e SHA-256 conferidos, retomada de onde parou e
// progresso em bytes. Usado pela IA local e pela preparação do computador.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { ErroAplicacao } from "../dominio/erros.ts";

export interface ArquivoBaixavel { arquivo: string; tamanho: number; sha256: string }

const MB = 1024 * 1024;

/** Tamanho legível: "850 MB" ou "2,5 GB". */
export const tamanhoLegivel = (bytes: number): string => (bytes >= 1024 * MB ? `${(bytes / (1024 * MB)).toFixed(1).replace(".", ",")} GB` : `${Math.round(bytes / MB)} MB`);

/**
 * Baixa um arquivo conferindo tamanho e SHA-256. Só recebe o nome final se estiver íntegro.
 * Se um download anterior parou no meio, continua de onde parou (quando o servidor permite).
 * `aoProgredir` recebe os bytes já baixados, com avisos limitados a alguns por segundo.
 */
export async function baixar(url: string, destino: string, esperado: ArquivoBaixavel, aoProgredir: (bytes: number) => void, sinal?: AbortSignal): Promise<void> {
  if (existsSync(destino) && statSync(destino).size === esperado.tamanho) { aoProgredir(esperado.tamanho); return; } // já baixado e conferido antes
  mkdirSync(path.dirname(destino), { recursive: true });
  const parcial = `${destino}.parcial`;
  let jaTem = existsSync(parcial) ? statSync(parcial).size : 0;
  if (jaTem >= esperado.tamanho) { rmSync(parcial, { force: true }); jaTem = 0; }
  let resposta: Response;
  try {
    resposta = await fetch(url, { signal: sinal, redirect: "follow", headers: jaTem ? { range: `bytes=${jaTem}-` } : {} });
  } catch (erro) {
    if (sinal?.aborted) throw new ErroAplicacao("cancelado", "Instalação cancelada. O que já foi baixado fica guardado para continuar depois.");
    throw new ErroAplicacao("sem-conexao", `Não foi possível baixar ${esperado.arquivo}: sem conexão com ${new URL(url).host} (${erro instanceof Error ? erro.message : erro}). O que já foi baixado fica guardado para continuar depois.`);
  }
  if (jaTem && resposta.status !== 206) jaTem = 0; // o servidor não continua downloads: recomeça
  if (!resposta.ok || !resposta.body) throw new ErroAplicacao("download-falhou", `Não foi possível baixar ${esperado.arquivo}: o servidor respondeu ${resposta.status}.`);
  // A soma de verificação cobre o arquivo inteiro: a parte já baixada entra na conta primeiro.
  const hash = createHash("sha256");
  if (jaTem) for await (const pedaco of createReadStream(parcial) as AsyncIterable<Buffer>) hash.update(pedaco);
  let recebidos = jaTem;
  let ultimoAviso = 0;
  aoProgredir(recebidos);
  const saida = createWriteStream(parcial, { flags: jaTem ? "a" : "w" });
  try {
    for await (const pedaco of Readable.fromWeb(resposta.body as never) as AsyncIterable<Buffer>) {
      hash.update(pedaco);
      recebidos += pedaco.length;
      if (!saida.write(pedaco)) await new Promise<void>((r) => saida.once("drain", () => r()));
      if (Date.now() - ultimoAviso >= 250) { ultimoAviso = Date.now(); aoProgredir(Math.min(recebidos, esperado.tamanho)); }
    }
    await new Promise<void>((resolver, rejeitar) => saida.end((erro?: Error | null) => (erro ? rejeitar(erro) : resolver())));
  } catch (erro) {
    saida.destroy();
    // A parte baixada fica guardada: a próxima tentativa continua dela.
    if (sinal?.aborted) throw new ErroAplicacao("cancelado", "Instalação cancelada. O que já foi baixado fica guardado para continuar depois.");
    throw new ErroAplicacao("download-falhou", `O download de ${esperado.arquivo} foi interrompido em ${tamanhoLegivel(recebidos)} de ${tamanhoLegivel(esperado.tamanho)} (${erro instanceof Error ? erro.message : erro}). Tente de novo: ele continua de onde parou.`);
  }
  aoProgredir(Math.min(recebidos, esperado.tamanho));
  const soma = hash.digest("hex");
  if (recebidos !== esperado.tamanho || soma !== esperado.sha256) {
    rmSync(parcial, { force: true });
    throw new ErroAplicacao("download-corrompido", `O arquivo ${esperado.arquivo} chegou diferente do publicado (tamanho ou soma de verificação não conferem) e foi descartado. Tente de novo.`);
  }
  renameSync(parcial, destino);
}

/** Desempacota com o tar do sistema (no Windows 10 e 11 ele também abre .zip). */
export function desempacotar(arquivo: string, pasta: string): Promise<void> {
  mkdirSync(pasta, { recursive: true });
  return new Promise((resolver, rejeitar) => {
    // No Windows, o tar do próprio sistema (abre .zip); outro tar no caminho de busca, como o do Git, pode não abrir.
    const doWindows = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    const tar = process.platform === "win32" && existsSync(doWindows) ? doWindows : "tar";
    const processo = spawn(tar, ["-xf", arquivo, "-C", pasta], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let erro = "";
    processo.stderr.on("data", (bloco: Buffer) => (erro += bloco.toString()));
    processo.on("error", (falha) => rejeitar(new ErroAplicacao("desempacotar", `Não foi possível desempacotar ${path.basename(arquivo)}: ${falha.message}`)));
    processo.on("close", (codigo) => (codigo === 0 ? resolver() : rejeitar(new ErroAplicacao("desempacotar", `Não foi possível desempacotar ${path.basename(arquivo)}: ${erro.trim().slice(-300)}`))));
  });
}
