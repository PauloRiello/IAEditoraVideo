// Ambiente da máquina (Python, FFmpeg, aceleração) guardado fora da pasta do programa,
// porque a atualização do aplicativo substitui a pasta do programa inteira.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { caminhoDaAceleracao, caminhosPadrao, montarCaminhos, pythonDoAmbiente } from "../../src/infra/caminhos.ts";
import { Aplicacao } from "../../src/nucleo/aplicacao.ts";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const temporarias: string[] = [];
function novaPasta(): string {
  const pasta = mkdtempSync(path.join(os.tmpdir(), "iaev-ambiente-"));
  temporarias.push(pasta);
  return pasta;
}
after(() => {
  for (const pasta of temporarias) rmSync(pasta, { recursive: true, force: true });
});

const pythonEm = (venv: string) => (process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python"));
function criarPython(venv: string): string {
  const arquivo = pythonEm(venv);
  mkdirSync(path.dirname(arquivo), { recursive: true });
  writeFileSync(arquivo, "");
  return arquivo;
}

test("o ambiente da máquina fica na pasta de dados, ou onde IAEV_AMBIENTE mandar", () => {
  const pasta = novaPasta();
  const padrao = caminhosPadrao({ IAEV_DADOS: path.join(pasta, "dados"), IAEV_BIBLIOTECA: path.join(pasta, "bib") });
  assert.equal(padrao.ambiente, path.join(pasta, "dados", "ambiente"));

  const escolhido = caminhosPadrao({ IAEV_DADOS: path.join(pasta, "dados"), IAEV_BIBLIOTECA: path.join(pasta, "bib"), IAEV_AMBIENTE: path.join(pasta, "maquina") });
  assert.equal(escolhido.ambiente, path.join(pasta, "maquina"));
});

test("instalado, dados e ambiente ficam na mesma pasta usada pelas instalações anteriores", () => {
  const pasta = novaPasta();
  const c = caminhosPadrao({ IAEV_INSTALADO: "1", LOCALAPPDATA: pasta });
  assert.equal(c.dados, path.join(pasta, "IAEditoraVideo"));
  assert.equal(c.ambiente, path.join(pasta, "IAEditoraVideo", "ambiente"));
});

test("Python e aceleração: o ambiente novo vale primeiro, a pasta do programa fica para instalações antigas", () => {
  const pasta = novaPasta();
  const programa = path.join(pasta, "programa");
  const c = montarCaminhos(path.join(pasta, "dados"), path.join(pasta, "bib"), programa);
  assert.equal(pythonDoAmbiente(c), null);

  const antigo = criarPython(path.join(programa, ".venv"));
  assert.equal(pythonDoAmbiente(c), antigo, "instalação antiga continua transcrevendo");
  const novo = criarPython(path.join(c.ambiente, "python"));
  assert.equal(pythonDoAmbiente(c), novo);

  const aceleracaoAntiga = path.join(programa, "config", "local.aceleracao.json");
  mkdirSync(path.dirname(aceleracaoAntiga), { recursive: true });
  writeFileSync(aceleracaoAntiga, "{}");
  assert.equal(caminhoDaAceleracao(c), aceleracaoAntiga, "sem o arquivo novo, lê o antigo");
  mkdirSync(c.ambiente, { recursive: true });
  writeFileSync(path.join(c.ambiente, "aceleracao.json"), "{}");
  assert.equal(caminhoDaAceleracao(c), path.join(c.ambiente, "aceleracao.json"));
});

test("a aplicação lê a placa de vídeo do ambiente na pasta de dados", () => {
  const pasta = novaPasta();
  const c = montarCaminhos(path.join(pasta, "dados"), path.join(pasta, "bib"), RAIZ);
  mkdirSync(c.ambiente, { recursive: true });
  writeFileSync(path.join(c.ambiente, "aceleracao.json"), JSON.stringify({ gpu: { fabricante: "nvidia", nome: "Placa de teste", vramMB: 7777 } }));
  const app = new Aplicacao(c);
  try {
    assert.equal(app.hardware.gpu?.vramMB, 7777);
  } finally {
    app.encerrar();
  }
});
