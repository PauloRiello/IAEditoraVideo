// Baixa vídeos de referência a partir de links (YouTube, TikTok, Instagram e outros sites que o
// yt-dlp conhece). Sem login: se o site exigir, o erro explica o que fazer. O andamento vem em
// linhas do próprio yt-dlp; o download que parou continua de onde parou na próxima tentativa.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { ErroAplicacao } from "../../src/dominio/erros.ts";

export type Site = "youtube" | "tiktok" | "instagram" | "outro";

/** Parâmetros que só servem para rastrear de onde o link foi compartilhado. */
const RASTREIO = /^(utm_.*|si|feature|t|igsh|igshid|lang|is_from_webapp|sender_device|share_.*|_r|_t)$/i;

/** Forma única de um link, para não baixar o mesmo vídeo duas vezes. */
export function normalizarLink(texto: string): { url: string; site: Site } | { erro: "lista" | "invalido" } {
  let u: URL;
  try {
    u = new URL(texto.trim());
  } catch {
    return { erro: "invalido" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { erro: "invalido" };
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
  const partes = u.pathname.split("/").filter(Boolean);

  if (host === "youtu.be" || host === "youtube.com" || host === "music.youtube.com") {
    const id = host === "youtu.be" ? partes[0] : ["shorts", "live", "embed"].includes(partes[0] ?? "") ? partes[1] : u.searchParams.get("v");
    if (!id) return { erro: partes[0] === "playlist" || u.searchParams.has("list") || partes[0]?.startsWith("@") ? "lista" : "invalido" };
    return { url: `https://www.youtube.com/watch?v=${id}`, site: "youtube" };
  }
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    // Vídeo: /@perfil/video/<id>, link curto /t/<código> ou vm./vt.tiktok.com/<código>.
    const curto = host !== "tiktok.com" || (partes[0] === "t" && partes[1]);
    if (!curto && !partes.includes("video") && !partes.includes("photo")) return { erro: "lista" };
    return { url: `https://${host === "tiktok.com" ? "www.tiktok.com" : host}/${partes.join("/")}`, site: "tiktok" };
  }
  if (host === "instagram.com") {
    // O Instagram também compartilha como /<usuario>/reel/<id>/.
    const indice = partes.findIndex((p) => ["reel", "reels", "p", "tv"].includes(p));
    if (indice < 0 || !partes[indice + 1]) return { erro: "lista" };
    const tipo = partes[indice] === "reels" ? "reel" : partes[indice];
    return { url: `https://www.instagram.com/${tipo}/${partes[indice + 1]}`, site: "instagram" };
  }
  for (const chave of [...u.searchParams.keys()]) if (RASTREIO.test(chave)) u.searchParams.delete(chave);
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  return { url: u.toString(), site: "outro" };
}

/** Linha de andamento emitida pelo modelo de progresso usado aqui ("IAEV <baixados> <total>"). */
export function lerAndamento(linha: string): { baixados: number; total: number } | null {
  const m = /^IAEV (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)\s*$/.exec(linha.trim());
  if (!m) return null;
  const total = Number(m[2]);
  return total > 0 ? { baixados: Number(m[1]), total } : null;
}

export type ErroDeLink = "login" | "indisponivel" | "invalido" | "sem-conexao" | "desconhecido";

export function classificarErro(saida: string): ErroDeLink {
  // Só as linhas de erro decidem: avisos soltos (WARNING) não dizem o que falhou.
  const linhasDeErro = saida.split(/\r?\n/).filter((l) => /error/i.test(l));
  const texto = linhasDeErro.length ? linhasDeErro.join("\n") : saida;
  if (/HTTP Error 4\d\d/i.test(texto) && !/HTTP Error 429/i.test(texto)) return "indisponivel"; // o site recusou: tentar de novo não resolve
  if (/login required|sign in to confirm|--cookies|log in to|requires authentication/i.test(texto)) return "login";
  if (/private video|video unavailable|has been removed|(video|content|post) (is )?not available|no longer available|does not exist/i.test(texto)) return "indisponivel";
  if (/unsupported url|is not a valid url/i.test(texto)) return "invalido";
  if (/getaddrinfo|timed out|connection reset|connection refused|network is unreachable|temporary failure in name resolution|urlopen error|HTTP Error 429/i.test(texto)) return "sem-conexao";
  return "desconhecido";
}

const NOMES: Record<Site, string> = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", outro: "" };

function mensagem(codigo: ErroDeLink | "lista", site: Site, saida: string): string {
  const quem = site === "outro" ? "Esse site" : `O ${NOMES[site]}`;
  switch (codigo) {
    case "login": return `${quem} só deixa baixar esse vídeo com login. Salve o vídeo pelo celular ou pelo navegador e arraste o arquivo para cá.`;
    case "indisponivel": return "Esse vídeo é privado, foi removido ou não está disponível.";
    case "invalido": return "Esse link não é de um vídeo que o programa consiga baixar.";
    case "lista": return "Esse link é de uma lista ou de um perfil. Cole o link de um vídeo só.";
    case "sem-conexao": return "A internet caiu ou o site não respondeu. Tente de novo: o download continua de onde parou.";
    default: return `Não foi possível baixar o vídeo: ${saida.trim().split(/\r?\n/).filter((l) => /error/i.test(l)).pop() ?? saida.trim().slice(-200)}`;
  }
}

export interface OpcoesDoDownload {
  /** Pasta onde o vídeo fica (Referências/ ou Referências/<perfil>/). */
  pasta: string;
  /** Executável do yt-dlp (do ambiente do Python). */
  ytDlp: string;
  /** Executável usado como Node pelo yt-dlp no YouTube (no aplicativo, ele mesmo). */
  jsRuntime: string;
  /** config/yt-dlp.conf (formato, nome do arquivo, sem playlist). */
  configuracao: string;
  aoAvancar: (etapa: string, fracao: number) => void;
  sinal?: AbortSignal;
}

export interface VideoBaixado {
  arquivo: string;
  titulo: string;
  autor: string;
  /** AAAA-MM-DD, ou vazio. */
  data: string;
  /** Nome do site para mostrar ("YouTube"). */
  site: string;
  urlOriginal: string;
}

function rodar(o: OpcoesDoDownload, argumentos: string[], aoLinha: (linha: string) => void): Promise<{ codigo: number | null; saida: string; erros: string }> {
  return new Promise((resolver) => {
    // Saída sempre em UTF-8: no Windows, sem isso o Python escreve em cp1252 e o caminho com
    // acento (a pasta "Referências", um nome de usuário) chega estragado.
    const processo = spawn(o.ytDlp, ["--encoding", "utf-8", "--config-locations", o.configuracao, "--js-runtimes", `node:${o.jsRuntime}`, ...argumentos], {
      windowsHide: true, signal: o.sinal, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    });
    processo.stdout.setEncoding("utf8");
    processo.stderr.setEncoding("utf8");
    let saida = "", erros = "", resto = "";
    processo.stdout.on("data", (bloco: string) => {
      saida += bloco;
      const linhas = (resto + bloco).split(/\r?\n/);
      resto = linhas.pop() ?? "";
      for (const linha of linhas) aoLinha(linha);
    });
    processo.stderr.on("data", (bloco: string) => {
      erros = (erros + bloco).slice(-8000);
      for (const linha of bloco.split(/\r?\n/)) aoLinha(linha); // o andamento pode sair aqui também
    });
    processo.on("error", (falha) => resolver({ codigo: null, saida, erros: `NAO-ABRIU ${falha.message}` }));
    processo.on("close", (codigo) => resolver({ codigo, saida: saida + resto, erros }));
  });
}

export interface MetadadosDoLink {
  /** Link normalizado como foi colado. */
  urlOriginal: string;
  /** Endereço do vídeo segundo o site (o mesmo para um link curto e o completo). */
  urlCanonica: string;
  titulo: string;
  autor: string;
  data: string;
  site: string;
  /** Quantos arquivos o download traz (vídeo e áudio separados = 2). */
  arquivos: number;
}

function erroDe(normal: { site: Site }, o: OpcoesDoDownload, erros: string): ErroAplicacao {
  if (o.sinal?.aborted) return new ErroAplicacao("cancelado", "Download cancelado.");
  if (erros.startsWith("NAO-ABRIU ")) {
    return new ErroAplicacao("baixador-ausente", "O baixador de vídeos não pôde ser aberto. Feche e abra o programa de novo; se continuar, o antivírus pode estar bloqueando o programa.");
  }
  const codigo = classificarErro(erros);
  return new ErroAplicacao(codigo, mensagem(codigo, normal.site, erros));
}

/** Lê os dados do vídeo sem baixar (título, autor, endereço oficial). */
export async function lerLink(link: string, o: OpcoesDoDownload): Promise<MetadadosDoLink> {
  const normal = normalizarLink(link);
  if ("erro" in normal) throw new ErroAplicacao(normal.erro, mensagem(normal.erro, "outro", ""));
  o.aoAvancar("Lendo o link", 0);
  const info = await rodar(o, ["-J", "--no-download", normal.url], () => undefined);
  if (info.codigo !== 0) throw erroDe(normal, o, info.erros);
  let dados: { title?: string; uploader?: string; channel?: string; upload_date?: string; webpage_url?: string; requested_formats?: unknown[] };
  try {
    dados = JSON.parse(info.saida);
  } catch {
    throw new ErroAplicacao("desconhecido", "O site respondeu de um jeito inesperado. Tente de novo mais tarde.");
  }
  const canonica = dados.webpage_url ? normalizarLink(dados.webpage_url) : normal;
  const data = /^(\d{4})(\d{2})(\d{2})$/.exec(dados.upload_date ?? "");
  return {
    urlOriginal: normal.url, urlCanonica: "url" in canonica ? canonica.url : normal.url,
    titulo: dados.title ?? normal.url, autor: dados.uploader ?? dados.channel ?? "", data: data ? `${data[1]}-${data[2]}-${data[3]}` : "",
    site: NOMES[normal.site] || new URL(normal.url).hostname.replace(/^www\./, ""), arquivos: Math.max(1, dados.requested_formats?.length ?? 1),
  };
}

/** Baixa um vídeo. Lança ErroAplicacao com o código do erro e uma mensagem simples. */
export async function baixarLink(link: string, o: OpcoesDoDownload, lido?: MetadadosDoLink): Promise<VideoBaixado> {
  const meta = lido ?? (await lerLink(link, o));
  const normal = normalizarLink(meta.urlOriginal) as { url: string; site: Site };
  const { arquivos, site } = meta;
  let concluidos = 0, ultimo = -1, atual = 0.05;
  const avancar = (etapa: string, fracao: number) => {
    atual = Math.max(atual, Math.min(0.99, fracao));
    o.aoAvancar(etapa, atual);
  };
  avancar(`Baixando de ${site}`, 0.05);
  let final = "";
  const download = await rodar(o, ["--newline", "--progress", "--progress-template", "download:IAEV %(progress.downloaded_bytes)s %(progress.total_bytes,progress.total_bytes_estimate)s", "--print", "after_move:filepath", "--paths", o.pasta, normal.url], (linha) => {
    const andamento = lerAndamento(linha);
    if (andamento) {
      if (andamento.baixados < ultimo) concluidos = Math.min(arquivos - 1, concluidos + 1); // começou o próximo arquivo (áudio)
      ultimo = andamento.baixados;
      const parte = Math.min(1, andamento.baixados / andamento.total);
      avancar(`Baixando de ${site}`, 0.05 + (0.9 * (concluidos + parte)) / arquivos);
      if (concluidos === arquivos - 1 && parte >= 1 && arquivos > 1) avancar("Juntando áudio e vídeo", 0.96);
      return;
    }
    if (linha.trim() && existsSync(linha.trim())) final = linha.trim();
  });
  if (download.codigo !== 0 || !final) throw erroDe(normal, o, download.erros || "o yt-dlp não informou o arquivo baixado");
  o.aoAvancar("Vídeo baixado", 1);
  return { arquivo: final, titulo: meta.titulo, autor: meta.autor, data: meta.data, site, urlOriginal: meta.urlCanonica };
}
