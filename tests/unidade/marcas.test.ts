// Marcas: cadastro, arquivos copiados, uso pelos projetos e cópia de segurança.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { MIGRACOES } from "../../src/infra/banco.ts";
import { montarCaminhos } from "../../src/infra/caminhos.ts";
import { execFileSync } from "node:child_process";
import { pythonDoAmbiente } from "../../src/infra/caminhos.ts";
import { iniciarServidor } from "../../src/interface/servidor.ts";
import { Aplicacao } from "../../src/nucleo/aplicacao.ts";
import { manualDeMarca } from "./apoio/pdf.ts";

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
function temLeitorDePdf(): boolean {
  const python = pythonDoAmbiente(montarCaminhos(path.join(os.tmpdir(), "iaev-sem-dados"), os.tmpdir(), RAIZ));
  try {
    return python !== null && (execFileSync(python, ["-c", "import pypdfium2, pypdf"]), true);
  } catch {
    return false;
  }
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

test("ler o manual pela tarefa guarda o PDF e as sugestões na marca", { skip: !temLeitorDePdf() }, async () => {
  const pasta = novaPasta();
  const app = new Aplicacao(caminhosEm(pasta));
  try {
    const marca = app.marcas.criar("Pelo manual");
    const pdf = path.join(pasta, "originais", "manual.pdf");
    mkdirSync(path.dirname(pdf), { recursive: true });
    writeFileSync(pdf, manualDeMarca());
    const { tarefa, conclusao } = app.fluxoDeMarcas.lerManual(marca.id, pdf);
    assert.equal(tarefa.tipo, "leitura-de-manual");
    const fim = await conclusao;
    assert.equal(fim.estado, "concluida", fim.erro ?? "");
    const lida = app.marcas.obter(marca.id);
    assert.deepEqual(lida.materiais.map((m) => m.nome), ["manual.pdf"]);
    assert.equal(lida.sugestoes?.cores[0].hex, "#1A2B3C");
    assert.ok(lida.sugestoes?.logos[0].arquivo.startsWith(app.marcas.pastaDaMarca(marca.id)));
    assert.equal(lida.estado, "rascunho", "nada é aplicado sem confirmação");
    assert.deepEqual(lida.cores, []);
  } finally {
    app.encerrar();
  }
});

test("rotas: criar, enviar logo, confirmar cores, marcar pronta; projeto só aceita marca pronta", async () => {
  const pasta = novaPasta();
  const app = new Aplicacao(caminhosEm(pasta));
  const servidor = await iniciarServidor(app, {});
  const pedir = async (rota: string, o: { metodo?: string; corpo?: unknown; arquivo?: Buffer } = {}) => {
    const r = await fetch(`http://127.0.0.1:${servidor.porta}${rota}`, {
      method: o.metodo ?? (o.corpo !== undefined || o.arquivo ? "POST" : "GET"),
      headers: { "x-iaev-sessao": servidor.token, "content-type": o.arquivo ? "application/octet-stream" : "application/json" },
      body: o.arquivo ? new Uint8Array(o.arquivo) : o.corpo !== undefined ? JSON.stringify(o.corpo) : undefined,
    });
    return { estado: r.status, dados: await r.json().catch(() => null) };
  };
  try {
    const criada = await pedir("/api/marcas", { corpo: { nome: "Pela janela" } });
    const id = criada.dados.id as string;
    assert.equal(criada.dados.estado, "rascunho");
    const logo = await pedir(`/api/marcas/${id}/arquivo?papel=logo&nome=logo.png`, { arquivo: Buffer.from("png falso") });
    assert.equal(logo.estado, 200);
    assert.ok(logo.dados.logo.endsWith("logo.png"));
    assert.equal((await pedir(`/api/marcas/${id}/arquivo?papel=logo&nome=virus.exe`, { arquivo: Buffer.from("x") })).estado, 415);
    assert.equal((await pedir(`/api/marcas/${id}`, { metodo: "PUT", corpo: { cores: [{ hex: "azul", papel: "primaria" }] } })).estado, 400);
    const cores = await pedir(`/api/marcas/${id}`, { metodo: "PUT", corpo: { cores: [{ hex: "#1a2b3c", papel: "primaria" }] } });
    assert.deepEqual(cores.dados.cores, [{ hex: "#1A2B3C", papel: "primaria", base: "observado", fonte: "escolhida pelo usuário" }]);
    const pendente = await pedir(`/api/marcas/${id}/fontes/pendente`, { corpo: { papel: "titulos", nome: "Fonte Proprietária" } });
    assert.deepEqual(pendente.dados.fontes.titulos, { nome: "Fonte Proprietária", arquivos: [], origem: "pendente", licenca: "" });

    const recusado = await pedir("/api/projetos", { corpo: { nome: "Com rascunho", configuracao: { marca: id } } });
    assert.equal(recusado.estado, 422);
    assert.match(recusado.dados.erro.mensagem, /ainda não está pronta/);
    assert.equal((await pedir(`/api/marcas/${id}/pronta`, { corpo: {} })).dados.estado, "pronta");
    const projeto = await pedir("/api/projetos", { corpo: { nome: "Com marca pronta", configuracao: { marca: id } } });
    assert.equal(projeto.estado, 200);
    const imagem = await fetch(`http://127.0.0.1:${servidor.porta}/api/marcas/${id}/imagem/logo`, { headers: { "x-iaev-sessao": servidor.token } });
    assert.equal(await imagem.text(), "png falso");
    assert.equal((await pedir(`/api/marcas/${id}`, { metodo: "DELETE" })).estado, 422, "marca em uso não é removida");
  } finally {
    await servidor.encerrar();
  }
});

test("leitura do manual: a cópia de segurança não leva as páginas extraídas, e ler de novo não acumula", { skip: !temLeitorDePdf() }, async () => {
  const pasta = novaPasta();
  const app = new Aplicacao(caminhosEm(pasta));
  try {
    const marca = app.marcas.criar("Sem acúmulo");
    const pdf = path.join(pasta, "originais", "manual.pdf");
    mkdirSync(path.dirname(pdf), { recursive: true });
    writeFileSync(pdf, manualDeMarca());
    await app.fluxoDeMarcas.lerManual(marca.id, pdf).conclusao;
    await app.fluxoDeMarcas.lerManual(marca.id, pdf).conclusao;
    const leituras = readdirSync(app.marcas.pastaDaMarca(marca.id)).filter((n) => n.startsWith("leitura-"));
    assert.equal(leituras.length, 1, leituras.join(", "));
    const copia = app.copiaDeSeguranca("manual");
    assert.deepEqual(readdirSync(path.join(copia.pasta, "marcas", marca.id)).filter((n) => n.startsWith("leitura-")), []);
  } finally {
    app.encerrar();
  }
});

test("projeto apontando para marca que não existe: a edição abre sem marca", () =>
  comApp((app) => {
    const projeto = app.criarProjeto("Marca sumida", "geral", undefined, { marca: "nao-existe" });
    assert.equal(app.edicao.marcaDesatualizada(projeto.id), false);
  }));

test("a ajuda da IA para escolher o logo só usa IA local (nada do manual vai para serviço externo)", async () => {
  const { FluxoDeMarcas, escolherModeloVisual } = await import("../../src/nucleo/marcas.ts");
  const local = { id: "ia-local", nome: "IA local", origem: "local" as const, capacidades: ["visao" as const], disponivel: async () => true, descreverImagens: async () => '{"ordem":[0]}' };
  assert.equal((await escolherModeloVisual({ selecionar: async () => local }))?.id, "ia-local");
  assert.equal(await escolherModeloVisual({ selecionar: async () => ({ ...local, id: "externo", origem: "externo" as const }) }), null, "provedor externo não recebe imagens do manual");
  assert.equal(await escolherModeloVisual({ selecionar: async () => { throw new Error("sem provedor"); } }), null);
  const pasta = novaPasta();
  const app = new Aplicacao(caminhosEm(pasta));
  try {
    let chamadas = 0;
    const externo = { id: "externo", nome: "Externo", origem: "externo" as const, capacidades: ["visao" as const], disponivel: async () => true, descreverImagens: async () => { chamadas++; return '{"ordem":[0]}'; } };
    const fluxo = new FluxoDeMarcas({ caminhos: app.caminhos, marcas: app.marcas, tarefas: app.tarefas, provedores: { selecionar: async () => externo }, registrar: () => undefined });
    const marca = app.marcas.criar("Privada");
    const pdf = path.join(pasta, "originais", "manual.pdf");
    mkdirSync(path.dirname(pdf), { recursive: true });
    writeFileSync(pdf, manualDeMarca());
    const fim = await fluxo.lerManual(marca.id, pdf).conclusao;
    if (temLeitorDePdf()) assert.equal(fim.estado, "concluida", fim.erro ?? "");
    assert.equal(chamadas, 0);
  } finally {
    app.encerrar();
  }
});
