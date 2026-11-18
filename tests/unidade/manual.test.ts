// Leitura do manual da marca: interpretação do texto (sem Python) e leitura real do PDF (com o
// Python do ambiente de desenvolvimento, pulada se ele não existir).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { extrairCores, extrairNomesDeFontes, lerManual, ordenarCandidatasALogo } from "../../Pipeline/brand/manual.ts";
import { pythonDoAmbiente, montarCaminhos } from "../../src/infra/caminhos.ts";
import { manualDeMarca, manualSemCodigos } from "./apoio/pdf.ts";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const PYTHON = pythonDoAmbiente(montarCaminhos(path.join(os.tmpdir(), "iaev-sem-dados"), os.tmpdir(), RAIZ));
const temPdf = PYTHON !== null && (() => {
  try {
    execFileSync(PYTHON, ["-c", "import pypdfium2, pypdf"]);
    return true;
  } catch {
    return false;
  }
})();
const temporarias: string[] = [];
after(() => {
  for (const pasta of temporarias) rmSync(pasta, { recursive: true, force: true });
});
function novaPasta(): string {
  const pasta = mkdtempSync(path.join(os.tmpdir(), "iaev-manual-"));
  temporarias.push(pasta);
  return pasta;
}

test("extrai cores escritas, com papel e página", () => {
  const cores = extrairCores([
    { numero: 1, texto: "Cor primária: #1A2B3C\nCor de destaque RGB 255 200 0\nR: 10 G: 20 B: 30" },
    { numero: 2, texto: "Cor secundária CMYK 0 100 100 0 e de novo #1a2b3c, Pantone 286 C" },
  ]);
  assert.deepEqual(cores, [
    { hex: "#1A2B3C", papel: "primaria", base: "observado", fonte: "manual, página 1" },
    { hex: "#FFC800", papel: "destaque", base: "observado", fonte: "manual, página 1" },
    { hex: "#0A141E", papel: null, base: "observado", fonte: "manual, página 1" },
    { hex: "#FF0000", papel: "secundaria", base: "observado", fonte: "manual, página 2 (convertido de CMYK)" },
  ]);
  assert.deepEqual(extrairCores([{ numero: 1, texto: "#ABC e cor 300 0 0 não é RGB" }]).map((c) => c.hex), ["#AABBCC"]);
});

test("nomes de fontes sem peso e sem fontes do sistema", () => {
  const fontes = extrairNomesDeFontes(
    [{ numero: 3, texto: "Tipografia de títulos: Montserrat\nFonte de texto: Open Sans." }],
    [{ nome: "Montserrat-Bold", pagina: 3 }, { nome: "Helvetica", pagina: 1 }, { nome: "OpenSans,Regular", pagina: 3 }, { nome: "Lato-Italic", pagina: 5 }, { nome: "ZapfDingbats", pagina: 1 }],
  );
  assert.deepEqual(fontes, [
    { nome: "Montserrat", pagina: 3, papel: "titulos" },
    { nome: "Open Sans", pagina: 3, papel: "texto" },
    { nome: "Lato", pagina: 5, papel: null },
  ]);
});

test("ordena candidatas a logo e descarta miniaturas e fotos de página inteira", () => {
  const base = { transparencia: false, fracaoDaPagina: 0.05 };
  const ordem = ordenarCandidatasALogo([
    { arquivo: "foto.png", pagina: 1, largura: 2000, altura: 1500, ...base, fracaoDaPagina: 0.95 },
    { arquivo: "icone.png", pagina: 1, largura: 32, altura: 32, ...base },
    { arquivo: "tarde.png", pagina: 7, largura: 400, altura: 200, ...base },
    { arquivo: "logo.png", pagina: 2, largura: 400, altura: 160, ...base, transparencia: true },
    { arquivo: "faixa.png", pagina: 1, largura: 3000, altura: 100, ...base },
    { arquivo: "cedo.png", pagina: 1, largura: 300, altura: 300, ...base },
  ]);
  assert.deepEqual(ordem.map((i) => i.arquivo), ["logo.png", "cedo.png", "tarde.png", "faixa.png"]);
});

test("lê o manual inteiro com porcentagem por página", { skip: !temPdf }, async () => {
  const pasta = novaPasta();
  const pdf = path.join(pasta, "manual.pdf");
  writeFileSync(pdf, manualDeMarca());
  const eventos: [string, number][] = [];
  const s = await lerManual(pdf, { pasta: path.join(pasta, "saida"), python: PYTHON as string, aoAvancar: (e, f) => eventos.push([e, f]) });
  assert.deepEqual(s.cores.map((c) => [c.hex, c.papel]), [["#1A2B3C", "primaria"], ["#FFC800", "destaque"], ["#FF0000", "secundaria"]]);
  assert.ok(s.cores.every((c) => c.base === "observado"));
  assert.ok(s.fontes.some((f) => f.nome === "Montserrat"), JSON.stringify(s.fontes));
  assert.ok(s.logos.length >= 1 && existsSync(s.logos[0].arquivo) && s.logos[0].pagina === 1 && s.logos[0].base === "estimado", JSON.stringify(s.logos));
  assert.deepEqual(s.avisos, []);
  const fracoes = eventos.map(([, f]) => f);
  for (let i = 1; i < fracoes.length; i++) assert.ok(fracoes[i] >= fracoes[i - 1]);
  assert.ok(eventos.some(([e]) => /página 2 de 2/.test(e)), eventos.map(([e]) => e).join(" | "));
  assert.equal(fracoes.at(-1), 1);
});

test("manual sem códigos de cor: cores medidas, estimadas, com aviso", { skip: !temPdf }, async () => {
  const pasta = novaPasta();
  const pdf = path.join(pasta, "manual.pdf");
  writeFileSync(pdf, manualSemCodigos());
  const s = await lerManual(pdf, { pasta: path.join(pasta, "saida"), python: PYTHON as string, aoAvancar: () => undefined });
  assert.ok(s.cores.length >= 1);
  assert.ok(s.cores.every((c) => c.base === "estimado" && c.fonte === "medida nas páginas"));
  assert.equal(s.cores[0].hex, "#FF0000");
  assert.deepEqual(s.avisos, ["Nenhum código de cor escrito no manual: cores medidas nas páginas.", "Nenhuma imagem do manual parece um logo: envie o arquivo do logo."]);
});

test("PDF com senha ou que não é PDF: erro claro, sem exceção crua", { skip: !temPdf }, async () => {
  const pasta = novaPasta();
  const aberto = path.join(pasta, "aberto.pdf");
  writeFileSync(aberto, manualSemCodigos());
  const cifrado = path.join(pasta, "cifrado.pdf");
  execFileSync(PYTHON as string, ["-c", `from pypdf import PdfReader, PdfWriter\nw = PdfWriter(clone_from=PdfReader(${JSON.stringify(aberto)}))\nw.encrypt("segredo")\nw.write(${JSON.stringify(cifrado)})`]);
  const falso = path.join(pasta, "falso.pdf");
  writeFileSync(falso, "isto é um texto, não um PDF");
  const opcoes = { pasta: path.join(pasta, "saida"), python: PYTHON as string, aoAvancar: () => undefined };
  await assert.rejects(lerManual(cifrado, opcoes), (e: Error & { codigo?: string }) => e.codigo === "manual-senha" && /senha/.test(e.message) && /à mão/.test(e.message));
  await assert.rejects(lerManual(falso, opcoes), (e: Error & { codigo?: string }) => e.codigo === "manual-invalido" && /não é um PDF/.test(e.message));
});

test("o pypdf falhar (ex.: AES-256 sem a biblioteca de criptografia) não vira 'não é PDF'", { skip: !temPdf }, async () => {
  const pasta = novaPasta();
  const pdf = path.join(pasta, "manual.pdf");
  writeFileSync(pdf, manualDeMarca());
  // Um pypdf falso no caminho do Python, que falha como o verdadeiro falha com AES-256.
  const falso = path.join(pasta, "falsos", "pypdf");
  mkdirSync(path.join(falso, "errors"), { recursive: true });
  writeFileSync(path.join(falso, "__init__.py"), "class PdfReader:\n    def __init__(self, *a, **k):\n        raise Exception('cryptography>=3.1 is required for AES algorithm')\n");
  writeFileSync(path.join(falso, "errors", "__init__.py"), "class PdfReadError(Exception):\n    pass\n");
  const antes = process.env.PYTHONPATH;
  process.env.PYTHONPATH = path.join(pasta, "falsos");
  try {
    const s = await lerManual(pdf, { pasta: path.join(pasta, "saida"), python: PYTHON as string, aoAvancar: () => undefined });
    assert.equal(s.cores[0].hex, "#1A2B3C");
  } finally {
    if (antes === undefined) delete process.env.PYTHONPATH;
    else process.env.PYTHONPATH = antes;
  }
});
