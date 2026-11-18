// Servidor em modo anfitrião: o aplicativo (Electron) inicia principal.ts como processo
// filho e conversa com ele por linhas JSON na saída padrão.

import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const temporarias: string[] = [];
after(() => {
  for (const pasta of temporarias) rmSync(pasta, { recursive: true, force: true });
});

function abrir(dados: string, extra: Record<string, string> = {}): { processo: ChildProcessWithoutNullStreams; linhas: Record<string, unknown>[]; esperar: (f: (l: Record<string, unknown>) => boolean) => Promise<Record<string, unknown>>; saida: Promise<number | null> } {
  const processo = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(RAIZ, "src", "interface", "principal.ts")], {
    env: { ...process.env, IAEV_ANFITRIAO: "1", IAEV_DADOS: dados, IAEV_BIBLIOTECA: path.join(path.dirname(dados), "biblioteca"), ...extra },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const linhas: Record<string, unknown>[] = [];
  const esperas: { f: (l: Record<string, unknown>) => boolean; r: (l: Record<string, unknown>) => void }[] = [];
  let resto = "";
  processo.stdout.on("data", (bloco: Buffer) => {
    const partes = (resto + bloco.toString()).split("\n");
    resto = partes.pop() ?? "";
    for (const texto of partes) {
      let linha: Record<string, unknown>;
      try {
        linha = JSON.parse(texto) as Record<string, unknown>;
      } catch {
        linha = { naoJson: texto }; // toda linha da saída deveria ser JSON
      }
      linhas.push(linha);
      for (const e of esperas.filter((x) => x.f(linha))) e.r(linha);
    }
  });
  const saida = new Promise<number | null>((r) => processo.on("exit", (codigo) => r(codigo)));
  const esperar = (f: (l: Record<string, unknown>) => boolean) =>
    new Promise<Record<string, unknown>>((r, rejeitar) => {
      const ja = linhas.find(f);
      if (ja) return r(ja);
      esperas.push({ f, r });
      void saida.then(() => rejeitar(new Error(`o processo saiu; linhas: ${JSON.stringify(linhas)}`)));
    });
  return { processo, linhas, esperar, saida };
}

test("no modo anfitrião, avisa o andamento e depois pronta, com porta e sessão", { timeout: 60_000 }, async () => {
  const pasta = mkdtempSync(path.join(os.tmpdir(), "iaev-anfitriao-"));
  temporarias.push(pasta);
  const a = abrir(path.join(pasta, "dados"));
  try {
    const pronta = await a.esperar((l) => l.pronta === true);
    assert.equal(typeof pronta.porta, "number");
    assert.equal(typeof pronta.token, "string");
    assert.ok(Array.isArray(pronta.avisos));
    const etapas = a.linhas.filter((l) => "etapa" in l);
    assert.deepEqual(etapas.map((l) => l.fracao), [0.2, 0.8]);
    assert.deepEqual(a.linhas.filter((l) => "naoJson" in l), [], "a saída padrão só tem linhas JSON");
    const saude = await fetch(`http://127.0.0.1:${pronta.porta}/api/saude`);
    assert.equal(saude.ok, true);
  } finally {
    a.processo.stdin.end();
    await a.saida;
  }
});

test("fechar a entrada padrão (o aplicativo fechou) encerra o servidor e apaga execucao.json", { timeout: 60_000 }, async () => {
  const pasta = mkdtempSync(path.join(os.tmpdir(), "iaev-anfitriao-"));
  temporarias.push(pasta);
  const dados = path.join(pasta, "dados");
  const a = abrir(dados);
  await a.esperar((l) => l.pronta === true);
  assert.ok(existsSync(path.join(dados, "execucao.json")));
  a.processo.stdin.end();
  assert.equal(await a.saida, 0);
  assert.equal(existsSync(path.join(dados, "execucao.json")), false);
});

test("erro ao abrir vira uma linha {erro} e código 1", { timeout: 60_000 }, async () => {
  const pasta = mkdtempSync(path.join(os.tmpdir(), "iaev-anfitriao-"));
  temporarias.push(pasta);
  const dados = path.join(pasta, "dados");
  writeFileSync(dados, "um arquivo no lugar da pasta de dados");
  const a = abrir(dados);
  const erro = await a.esperar((l) => "erro" in l);
  assert.equal(typeof erro.erro, "string");
  assert.equal(await a.saida, 1);
});

test("avisos da preparação (ex.: sem internet) chegam ao painel pela linha pronta", { timeout: 60_000 }, async () => {
  const pasta = mkdtempSync(path.join(os.tmpdir(), "iaev-anfitriao-"));
  temporarias.push(pasta);
  const aviso = "O FFmpeg não foi instalado: sem conexão.";
  const a = abrir(path.join(pasta, "dados"), { IAEV_AVISOS_DA_PREPARACAO: JSON.stringify([aviso]) });
  try {
    const pronta = await a.esperar((l) => l.pronta === true);
    const avisos = pronta.avisos as string[];
    assert.ok(avisos.some((x) => x.includes(aviso) && /abra o programa de novo/.test(x)), JSON.stringify(avisos));
  } finally {
    a.processo.stdin.end();
    await a.saida;
  }
});
