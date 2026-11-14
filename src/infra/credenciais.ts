// Cofre de credenciais: chaves de API dos provedores externos opcionais.
// Ficam em um arquivo próprio na pasta de dados do usuário (fora do programa e do Git),
// legível só pelo usuário. Nunca vão para as configurações, os registros ou as cópias de segurança.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const arquivoDeCredenciais = (arquivoDeConfiguracoes: string): string => path.join(path.dirname(arquivoDeConfiguracoes), "credenciais.json");

/** Chaves guardadas, por id de provedor. Arquivo ausente ou ilegível equivale a nenhuma chave. */
export function carregarCredenciais(arquivo: string): Record<string, string> {
  try {
    if (!existsSync(arquivo)) return {};
    const lido = JSON.parse(readFileSync(arquivo, "utf8")) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(lido).filter((par): par is [string, string] => typeof par[1] === "string" && par[1].length > 0));
  } catch {
    return {};
  }
}

export function salvarCredenciais(arquivo: string, chaves: Record<string, string>): void {
  mkdirSync(path.dirname(arquivo), { recursive: true });
  const temporario = `${arquivo}.tmp`;
  writeFileSync(temporario, `${JSON.stringify(chaves, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporario, arquivo);
  try {
    chmodSync(arquivo, 0o600); // no Windows a pasta do usuário já é restrita a ele
  } catch {
    // sistema de arquivos sem permissões POSIX
  }
}

/** Remove de um texto qualquer chave conhecida, para que mensagens de erro nunca a exponham. */
export function ocultarChaves(texto: string, chaves: Record<string, string>): string {
  let limpo = texto;
  for (const chave of Object.values(chaves)) if (chave.length >= 6) limpo = limpo.split(chave).join("[chave oculta]");
  return limpo;
}
