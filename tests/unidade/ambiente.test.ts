// Ambiente da máquina (Python, FFmpeg, aceleração) guardado fora da pasta do programa,
// porque a atualização do aplicativo substitui a pasta do programa inteira.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { caminhoDaAceleracao, caminhosPadrao, montarCaminhos, pythonDoAmbiente } from "../../src/infra/caminhos.ts";
import { prepararEmLinhas } from "../../src/interface/preparar.ts";
import { Aplicacao } from "../../src/nucleo/aplicacao.ts";
import { prepararAmbiente, situacaoDoAmbiente, type CatalogoDeFerramentas } from "../../src/servicos/ambiente.ts";

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

// ---------------------------------------------------------------------------
// Preparação da máquina (FFmpeg, Python, pacotes, aceleração), com ferramentas falsas
// servidas por um servidor local. Os scripts falsos são de shell: só fora do Windows.

const naoWindows = process.platform !== "win32";

/** Pacote .tar.gz com os arquivos dados (caminho relativo → conteúdo), todos executáveis. */
function empacotar(pasta: string, nome: string, arquivos: Record<string, string>): { arquivo: string; tamanho: number; sha256: string } {
  const raiz = path.join(pasta, `${nome}-conteudo`);
  for (const [relativo, conteudo] of Object.entries(arquivos)) {
    const destino = path.join(raiz, relativo);
    mkdirSync(path.dirname(destino), { recursive: true });
    writeFileSync(destino, conteudo, { mode: 0o755 });
  }
  const arquivo = `${nome}.tar.gz`;
  execFileSync("tar", ["-czf", path.join(pasta, arquivo), "-C", raiz, "."]);
  const dados = readFileSync(path.join(pasta, arquivo));
  return { arquivo, tamanho: dados.length, sha256: createHash("sha256").update(dados).digest("hex") };
}

// Python falso: "-m venv DIR" cria DIR/bin/python; esse, com "-m pip", anota a chamada e imprime como o pip.
const PYTHON_DO_VENV = `#!/bin/sh
echo pip >> "$(dirname "$0")/../chamadas-do-pip"
echo "Collecting faster-whisper==1.2.1"
echo "Collecting av==18.1.0"
echo "Requirement already satisfied: yt-dlp"
echo "Successfully installed av faster-whisper"
`;
const PYTHON_PORTATIL = `#!/bin/sh
if [ "$1" = "-m" ] && [ "$2" = "venv" ]; then
  mkdir -p "$3/bin"
  cp "$(dirname "$0")/python-do-venv" "$3/bin/python"
  chmod +x "$3/bin/python"
fi
`;

interface Servidor { endereco: string; pedidos: string[]; fechar: () => Promise<void> }
async function servir(pasta: string): Promise<Servidor> {
  const pedidos: string[] = [];
  const servidor = createServer((pedido, resposta) => {
    pedidos.push(pedido.url ?? "");
    const arquivo = path.join(pasta, decodeURIComponent((pedido.url ?? "").split("/").pop() ?? ""));
    if (!existsSync(arquivo)) { resposta.writeHead(404).end(); return; }
    resposta.writeHead(200).end(readFileSync(arquivo));
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", () => r()));
  return { endereco: `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`, pedidos, fechar: () => new Promise((r) => servidor.close(() => r())) };
}

function cenario() {
  const pasta = novaPasta();
  const pacotes = path.join(pasta, "pacotes");
  mkdirSync(pacotes);
  const ffmpeg = empacotar(pacotes, "ffmpeg-falso", { "ffmpeg-9/bin/ffmpeg": "#!/bin/sh\n", "ffmpeg-9/bin/ffprobe": "#!/bin/sh\n" });
  const python = empacotar(pacotes, "python-falso", { "python/bin/python3": PYTHON_PORTATIL, "python/bin/python-do-venv": PYTHON_DO_VENV });
  const plataforma = { plataforma: process.platform, arquitetura: process.arch };
  const catalogo: CatalogoDeFerramentas = {
    ffmpeg: { nome: "FFmpeg", versao: "9", licenca: "-", origem: "-", endereco: "-", variantes: [{ ...plataforma, ...ffmpeg }] },
    python: { nome: "Python", versao: "3.12", licenca: "-", origem: "-", endereco: "-", variantes: [{ ...plataforma, ...python }] },
  };
  // Pasta do programa própria: a do repositório tem um .venv antigo, que valeria primeiro.
  const programa = path.join(pasta, "programa");
  mkdirSync(programa);
  writeFileSync(path.join(programa, "requirements.txt"), readFileSync(path.join(RAIZ, "requirements.txt")));
  const caminhos = montarCaminhos(path.join(pasta, "dados"), path.join(pasta, "bib"), programa);
  let deteccoes = 0;
  const opcoes = (endereco: string, eventos: [string, number][] = []) => ({
    caminhos,
    catalogo,
    origens: { ffmpeg: `${endereco}/`, python: `${endereco}/` },
    sistema: { ffmpeg: false, python: null },
    aoProgredir: (etapa: string, fracao: number) => eventos.push([etapa, fracao]),
    detectarAceleracao: async () => {
      deteccoes += 1;
      mkdirSync(caminhos.ambiente, { recursive: true });
      writeFileSync(path.join(caminhos.ambiente, "aceleracao.json"), JSON.stringify({ gpu: null, whisper: { bibliotecasCudaPendentes: false } }));
    },
  });
  const chamadasDoPip = () => (existsSync(path.join(caminhos.ambiente, "python", "chamadas-do-pip")) ? readFileSync(path.join(caminhos.ambiente, "python", "chamadas-do-pip"), "utf8").trim().split("\n").length : 0);
  return { pacotes, caminhos, opcoes, chamadasDoPip, deteccoes: () => deteccoes };
}

test("prepara o que falta, na ordem, com a porcentagem só avançando", { skip: !naoWindows }, async () => {
  const c = cenario();
  const servidor = await servir(c.pacotes);
  try {
    const eventos: [string, number][] = [];
    const resultado = await prepararAmbiente(c.opcoes(servidor.endereco, eventos));
    assert.deepEqual(resultado.faltando, []);
    assert.deepEqual(resultado.avisos, []);
    assert.equal(resultado.ffmpeg && resultado.python && resultado.whisper && resultado.aceleracao, true);
    assert.ok(existsSync(path.join(c.caminhos.ambiente, "ferramentas", "ffmpeg", "bin", "ffmpeg")));
    assert.equal(pythonDoAmbiente(c.caminhos), path.join(c.caminhos.ambiente, "python", "bin", "python"));

    const fracoes = eventos.map(([, f]) => f);
    assert.equal(fracoes[0], 0);
    assert.equal(fracoes.at(-1), 1);
    for (let i = 1; i < fracoes.length; i++) assert.ok(fracoes[i] >= fracoes[i - 1], `a porcentagem voltou em "${eventos[i][0]}"`);
    const primeira = (trecho: RegExp) => eventos.findIndex(([etapa]) => trecho.test(etapa));
    const ordem = [/FFmpeg/, /Python/, /pacotes/i, /placa de vídeo/i].map(primeira);
    assert.ok(ordem.every((i) => i >= 0), `etapas: ${eventos.map(([e]) => e).join(" | ")}`);
    assert.deepEqual([...ordem].sort((a, b) => a - b), ordem);
  } finally {
    await servidor.fechar();
  }
});

test("o que já existe não é baixado nem instalado de novo", { skip: !naoWindows }, async () => {
  const c = cenario();
  const servidor = await servir(c.pacotes);
  try {
    await prepararAmbiente(c.opcoes(servidor.endereco));
    const pedidos = servidor.pedidos.length;
    assert.equal(c.chamadasDoPip(), 1);
    const segunda = await prepararAmbiente(c.opcoes(servidor.endereco));
    assert.deepEqual(segunda.faltando, []);
    assert.equal(servidor.pedidos.length, pedidos, "nada foi baixado de novo");
    assert.equal(c.chamadasDoPip(), 1, "os pacotes não foram reinstalados");
    assert.equal(c.deteccoes(), 1, "a placa não foi detectada de novo");
    assert.deepEqual(situacaoDoAmbiente(c.caminhos).faltando, []);
  } finally {
    await servidor.fechar();
  }
});

test("sem internet: aviso claro, sem travar, e a segunda tentativa completa", { skip: !naoWindows }, async () => {
  const c = cenario();
  const fechado = await servir(c.pacotes);
  const enderecoFechado = fechado.endereco;
  await fechado.fechar();

  const primeira = await prepararAmbiente(c.opcoes(enderecoFechado));
  assert.ok(primeira.faltando.includes("FFmpeg") && primeira.faltando.includes("Python"), primeira.faltando.join(", "));
  assert.ok(primeira.avisos.some((a) => /sem conexão/.test(a)), primeira.avisos.join(" | "));

  const servidor = await servir(c.pacotes);
  try {
    const segunda = await prepararAmbiente(c.opcoes(servidor.endereco));
    assert.deepEqual(segunda.faltando, []);
  } finally {
    await servidor.fechar();
  }
});

test("pacotes Python mudaram: a preparação reinstala só eles", { skip: !naoWindows }, async () => {
  const c = cenario();
  const servidor = await servir(c.pacotes);
  try {
    await prepararAmbiente(c.opcoes(servidor.endereco));
    writeFileSync(path.join(c.caminhos.ambiente, "python", ".requisitos"), "outra versão");
    assert.deepEqual(situacaoDoAmbiente(c.caminhos).faltando, ["Whisper"]);
    await prepararAmbiente(c.opcoes(servidor.endereco));
    assert.equal(c.chamadasDoPip(), 2);
  } finally {
    await servidor.fechar();
  }
});

test("preparar.ts fala em linhas JSON e termina com pronto ou erro", async () => {
  const linhas: string[] = [];
  await prepararEmLinhas(async (aoProgredir) => {
    aoProgredir("Baixando o FFmpeg", 0.1);
    return { ffmpeg: true, python: true, whisper: false, aceleracao: true, faltando: ["Whisper"], avisos: ["sem conexão"] };
  }, (linha) => linhas.push(linha));
  assert.deepEqual(linhas.map((l) => JSON.parse(l)), [
    { etapa: "Baixando o FFmpeg", fracao: 0.1 },
    { pronto: true, faltando: ["Whisper"], avisos: ["sem conexão"] },
  ]);

  const comErro: string[] = [];
  await prepararEmLinhas(async () => { throw new Error("disco cheio"); }, (linha) => comErro.push(linha));
  assert.deepEqual(JSON.parse(comErro.at(-1) as string), { erro: "disco cheio" });
});
