// Marcas: cadastro, arquivos copiados, uso pelos projetos e cópia de segurança.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { MIGRACOES } from "../../src/infra/banco.ts";
import { montarCaminhos } from "../../src/infra/caminhos.ts";
import { Aplicacao } from "../../src/nucleo/aplicacao.ts";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const temporarias: string[] = [];
after(() => {
  for (const pasta of temporarias) rmSync(pasta, { recursive: true, force: true });
});
function novaPasta(): string {
  const pasta = mkdtempSync(path.join(os.tmpdir(), "iaev-marcas-"));
  temporarias.push(pasta);
  return pasta;
}
const caminhosEm = (pasta: string) => montarCaminhos(path.join(pasta, "dados"), path.join(pasta, "bib"), RAIZ);
function comApp(teste: (app: Aplicacao, pasta: string) => void, pasta = novaPasta()): void {
  const app = new Aplicacao(caminhosEm(pasta));
  try {
    teste(app, pasta);
  } finally {
    app.encerrar();
  }
}
function arquivo(pasta: string, nome: string, conteudo = "conteúdo"): string {
  const caminho = path.join(pasta, "originais", nome);
  mkdirSync(path.dirname(caminho), { recursive: true });
  writeFileSync(caminho, conteudo);
  return caminho;
}

test("cria, edita e marca como pronta só com logo e cor", () =>
  comApp((app, pasta) => {
    const marca = app.marcas.criar("Loja Azul");
    assert.equal(marca.estado, "rascunho");
    assert.deepEqual(marca.logoPosicao, { canto: "superior-direito", alturaRelativa: 0.08, opacidade: 0.85 });
    assert.throws(() => app.marcas.marcarPronta(marca.id), (erro: Error & { codigo?: string }) => erro.codigo === "marca-incompleta");
    app.marcas.guardarArquivo(marca.id, arquivo(pasta, "logo.png"), "logo");
    assert.throws(() => app.marcas.marcarPronta(marca.id), (erro: Error & { codigo?: string }) => erro.codigo === "marca-incompleta");
    app.marcas.atualizar(marca.id, { cores: [{ hex: "#1A2B3C", papel: "primaria", base: "observado", fonte: "manual, página 4" }] });
    const pronta = app.marcas.marcarPronta(marca.id);
    assert.equal(pronta.estado, "pronta");
    assert.equal(app.marcas.listar().length, 1);
    assert.equal(app.marcas.obter(marca.id).cores[0].hex, "#1A2B3C");
  }));

test("arquivos são copiados para a pasta da marca; o original não é tocado", () =>
  comApp((app, pasta) => {
    const marca = app.marcas.criar("Original intacto");
    const original = arquivo(pasta, "manual.pdf", "%PDF-1.4 manual");
    const antes = statSync(original).mtimeMs;
    const copia = app.marcas.guardarArquivo(marca.id, original, "material");
    assert.notEqual(copia, original);
    assert.ok(copia.startsWith(path.join(app.caminhos.dados, "marcas", marca.id)));
    assert.equal(readFileSync(copia, "utf8"), "%PDF-1.4 manual");
    assert.equal(readFileSync(original, "utf8"), "%PDF-1.4 manual");
    assert.equal(statSync(original).mtimeMs, antes);
    // Mesmo nome de novo: nome único, sem sobrescrever.
    const segunda = app.marcas.guardarArquivo(marca.id, original, "material");
    assert.notEqual(segunda, copia);
    assert.deepEqual(app.marcas.obter(marca.id).materiais.map((m) => m.nome), ["manual.pdf", "manual.pdf"]);
  }));

test("não remove marca usada por projeto", () =>
  comApp((app, pasta) => {
    const marca = app.marcas.criar("Em uso");
    app.marcas.guardarArquivo(marca.id, arquivo(pasta, "logo.png"), "logo");
    app.criarProjeto("Com marca", "geral", undefined, { marca: marca.id });
    assert.throws(() => app.marcas.remover(marca.id), (erro: Error & { codigo?: string }) => erro.codigo === "marca-em-uso");
    const livre = app.marcas.criar("Livre");
    app.marcas.remover(livre.id);
    assert.equal(app.marcas.listar().length, 1);
  }));

test("a cópia de segurança leva as marcas e seus arquivos", () =>
  comApp((app, pasta) => {
    const marca = app.marcas.criar("Na cópia");
    app.marcas.guardarArquivo(marca.id, arquivo(pasta, "logo.png", "logo"), "logo");
    const copia = app.copiaDeSeguranca("manual");
    const logoNaCopia = path.join(copia.pasta, "marcas", marca.id, "logo.png");
    assert.equal(readFileSync(logoNaCopia, "utf8"), "logo");
  }));

test("banco antigo migra e projetos antigos ficam sem marca", () => {
  const pasta = novaPasta();
  const caminhos = caminhosEm(pasta);
  mkdirSync(path.dirname(caminhos.banco), { recursive: true });
  const antigo = new DatabaseSync(caminhos.banco);
  for (const migracao of MIGRACOES.slice(0, -1)) antigo.exec(migracao);
  antigo.exec(`PRAGMA user_version = ${MIGRACOES.length - 1}`);
  antigo.close();
  comApp((app) => {
    const projeto = app.criarProjeto("Antigo", "geral");
    assert.equal(projeto.configuracao.marca, "");
    assert.deepEqual(app.marcas.listar(), []);
  }, pasta);
});
