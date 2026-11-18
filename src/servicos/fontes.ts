// Fontes da marca pelo Google Fonts: catálogo público, sem chave, só HTTPS e só quando o
// usuário confirma na janela. Baixa os pesos 400 e 700 (ou os que a família tiver), nos
// subconjuntos latin e latin-ext, e guarda na pasta da marca.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ErroAplicacao } from "../dominio/erros.ts";

const ORIGEM = "https://fonts.googleapis.com";
export const LICENCA_DO_GOOGLE_FONTS = "Google Fonts (SIL Open Font License ou Apache 2.0)";

interface Opcoes { origem?: string; sinal?: AbortSignal }

/** "  open   sans " → "Open Sans"; palavras com maiúsculas (IBM) ficam como estão. */
function nomeDaFamilia(nome: string): string {
  return nome.trim().split(/\s+/).map((p) => (p === p.toLowerCase() ? p.charAt(0).toUpperCase() + p.slice(1) : p)).join(" ");
}

const semConexao = (erro: unknown) =>
  new ErroAplicacao("sem-conexao", `Sem conexão com o Google Fonts (${erro instanceof Error ? erro.message : erro}). Confira a internet; a fonte fica pendente até lá.`);

/** CSS da família: primeiro com 400 e 700; se a família não tiver os dois, sem pesos. null se não existir. */
async function css(familia: string, o: Opcoes): Promise<string | null> {
  const base = `${o.origem ?? ORIGEM}/css2?family=${encodeURIComponent(familia).replace(/%20/g, "+")}`;
  for (const url of [`${base}:wght@400;700&display=swap`, `${base}&display=swap`]) {
    let resposta: Response;
    try {
      resposta = await fetch(url, { signal: o.sinal });
    } catch (erro) {
      throw semConexao(erro);
    }
    if (resposta.ok) return resposta.text();
    if (resposta.status !== 400) throw new ErroAplicacao("google-fonts", `O Google Fonts respondeu ${resposta.status}. Tente de novo mais tarde.`);
  }
  return null;
}

export async function procurarNoGoogleFonts(nome: string, o: Opcoes = {}): Promise<{ familia: string; licenca: string } | null> {
  const texto = await css(nomeDaFamilia(nome), o);
  if (!texto) return null;
  const familia = /font-family:\s*['"]?([^'";]+)['"]?/.exec(texto)?.[1]?.trim() ?? nomeDaFamilia(nome);
  return { familia, licenca: LICENCA_DO_GOOGLE_FONTS };
}

interface Bloco { subconjunto: string | null; estilo: string; peso: string; url: string }

function blocos(texto: string): Bloco[] {
  const lista: Bloco[] = [];
  for (const m of texto.matchAll(/(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g)) {
    const corpo = m[2];
    const url = /url\(([^)]+)\)/.exec(corpo)?.[1]?.replace(/['"]/g, "");
    if (!url) continue;
    lista.push({ subconjunto: m[1] ?? null, estilo: /font-style:\s*(\w+)/.exec(corpo)?.[1] ?? "normal", peso: /font-weight:\s*(\d+)/.exec(corpo)?.[1] ?? "400", url });
  }
  return lista;
}

/** Baixa os arquivos da família para `pasta`. Nada é gravado se algum download falhar. */
export async function baixarDoGoogleFonts(familia: string, pasta: string, o: Opcoes & { aoAvancar: (etapa: string, fracao: number) => void }): Promise<string[]> {
  o.aoAvancar(`Procurando ${familia} no Google Fonts`, 0);
  const texto = await css(nomeDaFamilia(familia), o);
  if (!texto) throw new ErroAplicacao("fonte-nao-encontrada", `${familia} não está no Google Fonts. Envie o arquivo da fonte.`);
  const todos = blocos(texto).filter((b) => b.estilo === "normal");
  const comSubconjunto = todos.some((b) => b.subconjunto);
  const escolhidos = comSubconjunto ? todos.filter((b) => b.subconjunto === "latin" || b.subconjunto === "latin-ext") : todos;
  if (escolhidos.length === 0) throw new ErroAplicacao("google-fonts", `O Google Fonts não trouxe arquivos para ${familia}.`);
  const baixados: { nome: string; dados: Buffer }[] = [];
  for (const [i, b] of escolhidos.entries()) {
    o.aoAvancar(`Baixando ${familia} (${i + 1} de ${escolhidos.length})`, i / escolhidos.length);
    let resposta: Response;
    try {
      resposta = await fetch(b.url, { signal: o.sinal });
    } catch (erro) {
      throw semConexao(erro);
    }
    if (!resposta.ok) throw new ErroAplicacao("google-fonts", `Não foi possível baixar ${familia}: o Google Fonts respondeu ${resposta.status}.`);
    const extensao = path.extname(new URL(b.url).pathname) || ".ttf";
    const nome = `${familia.replace(/[^\w-]+/g, "")}-${b.peso}${b.subconjunto ? `-${b.subconjunto}` : ""}${extensao}`;
    baixados.push({ nome, dados: Buffer.from(await resposta.arrayBuffer()) });
  }
  mkdirSync(pasta, { recursive: true });
  const arquivos = baixados.map(({ nome, dados }) => {
    const destino = path.join(pasta, nome);
    writeFileSync(destino, dados);
    return destino;
  });
  o.aoAvancar(`${familia} baixada`, 1);
  return arquivos;
}
