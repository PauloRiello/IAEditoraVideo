// Leitura do manual da marca em PDF. O Python (ler_manual.py) só extrai texto, fontes, imagens e
// páginas; aqui se interpreta: códigos de cor escritos (observado, com a página), nomes das
// fontes, candidatas a logo e, sem códigos escritos, cores medidas nas páginas (estimado).

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ErroAplicacao } from "../../src/dominio/erros.ts";
import type { CorDaMarca, PapelDaCor, SugestoesDoManual } from "../../src/dominio/marca.ts";
import { ffmpeg } from "../analysis/ferramentas.ts";

export interface PaginaDoManual { numero: number; texto: string }
export interface ImagemCandidata { arquivo: string; pagina: number; largura: number; altura: number; transparencia: boolean; fracaoDaPagina: number }

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0").toUpperCase();
const paraHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

/** Papel pela palavra mais próxima antes do código (até ~60 caracteres). */
function papelPeloContexto(antes: string): PapelDaCor | null {
  const trecho = sem(antes.slice(antes.lastIndexOf("\n") + 1).slice(-60)); // só a mesma linha
  const palavras: [RegExp, PapelDaCor][] = [[/primaria|principal/g, "primaria"], [/secundaria/g, "secundaria"], [/destaque|apoio|acento/g, "destaque"], [/fundo/g, "fundo"], [/texto/g, "texto"]];
  let melhor: PapelDaCor | null = null, posicao = -1;
  for (const [padrao, papel] of palavras) for (const m of trecho.matchAll(padrao)) if ((m.index ?? -1) > posicao) { posicao = m.index ?? -1; melhor = papel; }
  return melhor;
}

/** Códigos de cor escritos no texto: #RRGGBB/#RGB, RGB r g b, R: G: B:, CMYK c m y k (convertido). */
export function extrairCores(paginas: PaginaDoManual[]): CorDaMarca[] {
  const cores: CorDaMarca[] = [];
  const achados: { indice: number; hex: string; cmyk: boolean }[] = [];
  const byte = (s: string) => { const n = Number(s); return n >= 0 && n <= 255 ? n : null; };
  for (const { numero, texto } of paginas) {
    achados.length = 0;
    for (const m of texto.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z])/gi)) {
      const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
      achados.push({ indice: m.index ?? 0, hex: `#${h.toUpperCase()}`, cmyk: false });
    }
    for (const m of texto.matchAll(/\bRGB\s*[:-]?\s*\(?\s*(\d{1,3})[\s,;/]+(\d{1,3})[\s,;/]+(\d{1,3})/gi)) {
      const [r, g, b] = [byte(m[1]), byte(m[2]), byte(m[3])];
      if (r !== null && g !== null && b !== null) achados.push({ indice: m.index ?? 0, hex: paraHex(r, g, b), cmyk: false });
    }
    for (const m of texto.matchAll(/\bR\s*[:=]\s*(\d{1,3})\s*[,;]?\s*G\s*[:=]\s*(\d{1,3})\s*[,;]?\s*B\s*[:=]\s*(\d{1,3})/g)) {
      const [r, g, b] = [byte(m[1]), byte(m[2]), byte(m[3])];
      if (r !== null && g !== null && b !== null) achados.push({ indice: m.index ?? 0, hex: paraHex(r, g, b), cmyk: false });
    }
    for (const m of texto.matchAll(/\bCMYK\s*[:-]?\s*\(?\s*(\d{1,3})%?[\s,;/]+(\d{1,3})%?[\s,;/]+(\d{1,3})%?[\s,;/]+(\d{1,3})%?/gi)) {
      const [c, mg, y, k] = [m[1], m[2], m[3], m[4]].map(Number);
      if ([c, mg, y, k].some((v) => v > 100)) continue;
      achados.push({ indice: m.index ?? 0, hex: paraHex(255 * (1 - c / 100) * (1 - k / 100), 255 * (1 - mg / 100) * (1 - k / 100), 255 * (1 - y / 100) * (1 - k / 100)), cmyk: true });
    }
    achados.sort((a, b) => a.indice - b.indice);
    for (const a of achados) {
      if (cores.some((c) => c.hex === a.hex)) continue;
      cores.push({ hex: a.hex, papel: papelPeloContexto(texto.slice(0, a.indice)), base: "observado", fonte: `manual, página ${numero}${a.cmyk ? " (convertido de CMYK)" : ""}` });
    }
  }
  return cores;
}

const FONTES_DO_SISTEMA = /^(arial|helvetica|times|timesnewroman|symbol|zapfdingbats|courier|couriernew)$/i;
const PESO = /[-,](thin|extralight|light|regular|book|medium|semibold|demibold|bold|extrabold|black|heavy|italic|oblique|condensed|[a-z]*italic)+.*$/i;

/** Nomes das fontes: do texto ("Tipografia: Montserrat") e das fontes usadas no PDF. */
export function extrairNomesDeFontes(paginas: PaginaDoManual[], fontesDoPdf: { nome: string; pagina: number }[]): { nome: string; pagina: number; papel: "titulos" | "texto" | null }[] {
  const lista: { nome: string; pagina: number; papel: "titulos" | "texto" | null }[] = [];
  const chave = (n: string) => sem(n).replace(/[^a-z0-9]/g, "");
  const juntar = (nome: string, pagina: number, papel: "titulos" | "texto" | null) => {
    const limpo = nome.trim().replace(/\s+/g, " ");
    if (!limpo || FONTES_DO_SISTEMA.test(chave(limpo)) || lista.some((f) => chave(f.nome) === chave(limpo))) return;
    lista.push({ nome: limpo, pagina, papel });
  };
  for (const { numero, texto } of paginas) {
    for (const m of texto.matchAll(/([Tt]ipografia|[Ff]onte|[Ff]am[ií]lia tipogr[aá]fica)([^:\n–-]{0,30})[:–-]\s*([A-Z][A-Za-z0-9]*(?: [A-Z][A-Za-z0-9]*){0,3})/g)) {
      const contexto = sem(m[2]);
      const papel = /titul|display|principal/.test(contexto) ? "titulos" : /texto|corpo|apoio|secundaria/.test(contexto) ? "texto" : null;
      juntar(m[3], numero, papel);
    }
  }
  for (const { nome, pagina } of fontesDoPdf) {
    // "OpenSans,Regular" e "Montserrat-Bold": tira o peso; "OpenSans" vira "Open Sans" só para comparar.
    juntar(nome.replace(PESO, "").replace(/([a-z])([A-Z])/g, "$1 $2"), pagina, null);
  }
  return lista;
}

/** Candidatas a logo: sem miniaturas e sem fotos de página inteira, as mais prováveis primeiro. */
export function ordenarCandidatasALogo(imagens: ImagemCandidata[]): ImagemCandidata[] {
  const uteis = imagens.filter((i) => Math.min(i.largura, i.altura) >= 48 && i.fracaoDaPagina <= 0.85);
  const repeticoes = (i: ImagemCandidata) => uteis.filter((o) => o.largura === i.largura && o.altura === i.altura).length;
  const proporcaoBoa = (i: ImagemCandidata) => { const p = i.largura / i.altura; return p >= 0.2 && p <= 5; };
  return [...uteis].sort((a, b) =>
    Number(b.transparencia) - Number(a.transparencia) || Number(proporcaoBoa(b)) - Number(proporcaoBoa(a)) || a.pagina - b.pagina || repeticoes(b) - repeticoes(a));
}

/** Até 5 cores dominantes das imagens, sem quase branco nem quase preto (estimado). */
export async function coresMedidas(arquivos: string[]): Promise<CorDaMarca[]> {
  const grupos = new Map<string, { r: number; g: number; b: number; n: number }>();
  for (const arquivo of arquivos) {
    const pixels = await ffmpeg(["-i", arquivo, "-vf", "scale=64:64", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    for (let i = 0; i + 2 < pixels.length; i += 3) {
      const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
      if ((r > 235 && g > 235 && b > 235) || (r < 20 && g < 20 && b < 20)) continue;
      const chave = `${r >> 5}-${g >> 5}-${b >> 5}`;
      const grupo = grupos.get(chave) ?? { r: 0, g: 0, b: 0, n: 0 };
      grupo.r += r; grupo.g += g; grupo.b += b; grupo.n += 1;
      grupos.set(chave, grupo);
    }
  }
  return [...grupos.values()].sort((a, b) => b.n - a.n).slice(0, 5)
    .map((g) => ({ hex: paraHex(g.r / g.n, g.g / g.n, g.b / g.n), papel: null, base: "estimado" as const, fonte: "medida nas páginas" }));
}

interface Extracao {
  paginas: PaginaDoManual[];
  fontes: { nome: string; pagina: number }[];
  imagens: ImagemCandidata[];
  renderizadas: { arquivo: string; pagina: number }[];
}

const MENSAGENS: Record<string, string> = {
  senha: "O manual está protegido por senha. Envie uma versão sem senha ou cadastre a marca à mão.",
  invalido: "Esse arquivo não é um PDF válido (ou está corrompido). Envie o manual em PDF ou cadastre a marca à mão.",
};

/** Roda o extrator em Python, com a porcentagem por página. */
function extrair(pdf: string, pasta: string, python: string, aoAvancar: (etapa: string, fracao: number) => void): Promise<Extracao> {
  const roteiro = path.join(path.dirname(fileURLToPath(import.meta.url)), "ler_manual.py");
  return new Promise((resolver, rejeitar) => {
    const processo = spawn(python, [roteiro, pdf, pasta], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } });
    processo.stdout.setEncoding("utf8");
    let resto = "", resultado: Extracao | null = null, erro: { erro: string; mensagem: string } | null = null, saidaDeErro = "";
    processo.stdout.on("data", (bloco: string) => {
      const linhas = (resto + bloco).split(/\r?\n/);
      resto = linhas.pop() ?? "";
      for (const linha of linhas) {
        if (!linha.trim()) continue;
        const m = JSON.parse(linha) as { pagina?: number; total?: number; erro?: string; mensagem?: string } & Partial<Extracao>;
        if (m.erro) erro = { erro: m.erro, mensagem: m.mensagem ?? "" };
        else if (m.paginas) resultado = m as Extracao;
        else if (m.pagina && m.total) aoAvancar(`Lendo o manual: página ${m.pagina} de ${m.total}`, 0.05 + 0.8 * (m.pagina / m.total));
      }
    });
    processo.stderr.on("data", (bloco: Buffer) => (saidaDeErro = (saidaDeErro + bloco.toString()).slice(-2000)));
    processo.on("error", (falha) => rejeitar(new ErroAplicacao("leitor-de-pdf-ausente", `O leitor de PDF não pôde ser aberto (${falha.message}). Feche e abra o programa com internet para terminar a preparação.`)));
    processo.on("close", () => {
      if (resultado) return resolver(resultado);
      const tipo = erro?.erro ?? "outro";
      rejeitar(new ErroAplicacao(`manual-${tipo}`, MENSAGENS[tipo] ?? `Não foi possível ler o manual: ${erro?.mensagem || saidaDeErro.trim().split(/\r?\n/).pop() || "erro desconhecido"}. Cadastre a marca à mão.`));
    });
  });
}

export interface OpcoesDaLeitura {
  /** Pasta (dentro da pasta da marca) para as imagens extraídas. */
  pasta: string;
  python: string;
  aoAvancar: (etapa: string, fracao: number) => void;
  /** IA local, opcional: devolve a ordem preferida das candidatas a logo (índices). */
  ia?: (imagens: string[]) => Promise<number[]>;
}

export async function lerManual(pdf: string, o: OpcoesDaLeitura): Promise<SugestoesDoManual> {
  o.aoAvancar("Abrindo o manual", 0);
  const extracao = await extrair(pdf, o.pasta, o.python, o.aoAvancar);
  const avisos: string[] = [];
  let cores = extrairCores(extracao.paginas);
  if (cores.length === 0) {
    o.aoAvancar("Medindo as cores das páginas", 0.88);
    cores = await coresMedidas(extracao.renderizadas.map((r) => r.arquivo));
    avisos.push("Nenhum código de cor escrito no manual: cores medidas nas páginas.");
  }
  const fontes = extrairNomesDeFontes(extracao.paginas, extracao.fontes);
  let candidatas = ordenarCandidatasALogo(extracao.imagens).slice(0, 6);
  if (o.ia && candidatas.length > 1) {
    o.aoAvancar("A IA local está olhando as candidatas a logo", 0.93);
    try {
      const ordem = await o.ia(candidatas.map((c) => c.arquivo));
      const reordenadas = ordem.filter((i) => candidatas[i]).map((i) => candidatas[i]);
      candidatas = [...reordenadas, ...candidatas.filter((c) => !reordenadas.includes(c))];
    } catch {
      avisos.push("A IA local não conseguiu ajudar a escolher o logo; a ordem é a das regras simples.");
    }
  }
  if (candidatas.length === 0) avisos.push("Nenhuma imagem do manual parece um logo: envie o arquivo do logo.");
  o.aoAvancar("Manual lido", 1);
  return { cores, fontes, logos: candidatas.map((c) => ({ arquivo: c.arquivo, pagina: c.pagina, base: "estimado" as const })), avisos };
}
