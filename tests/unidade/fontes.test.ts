// Fontes da marca pelo Google Fonts, com um servidor local imitando a API CSS pública.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { baixarDoGoogleFonts, procurarNoGoogleFonts } from "../../src/servicos/fontes.ts";

const temporarias: string[] = [];
after(() => {
  for (const pasta of temporarias) rmSync(pasta, { recursive: true, force: true });
});

async function googleFalso(): Promise<{ origem: string; pedidos: string[]; fechar: () => Promise<void> }> {
  const pedidos: string[] = [];
  const servidor = createServer((pedido, resposta) => {
    const url = new URL(pedido.url ?? "/", "http://x");
    pedidos.push(url.pathname + url.search);
    const origem = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    if (url.pathname === "/css2") {
      const familia = (url.searchParams.get("family") ?? "").split(":")[0];
      if (familia !== "Montserrat") { resposta.writeHead(400).end("Font family not found"); return; }
      const bloco = (subconjunto: string, peso: number) =>
        `/* ${subconjunto} */\n@font-face {\n  font-family: 'Montserrat';\n  font-style: normal;\n  font-weight: ${peso};\n  src: url(${origem}/s/montserrat/${subconjunto}-${peso}.woff2) format('woff2');\n}\n`;
      resposta.writeHead(200, { "content-type": "text/css" }).end(["cyrillic", "latin-ext", "latin"].flatMap((s) => [bloco(s, 400), bloco(s, 700)]).join(""));
      return;
    }
    if (url.pathname.startsWith("/s/")) { resposta.writeHead(200).end(`fonte ${url.pathname}`); return; }
    resposta.writeHead(404).end();
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", () => r()));
  return { origem: `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`, pedidos, fechar: () => new Promise((r) => servidor.close(() => r())) };
}

test("encontra Montserrat (sem diferença de maiúsculas e espaços) e baixa 400 e 700, latin e latin-ext", async () => {
  const g = await googleFalso();
  const pasta = mkdtempSync(path.join(os.tmpdir(), "iaev-fontes-"));
  temporarias.push(pasta);
  try {
    assert.deepEqual(await procurarNoGoogleFonts("  montserrat ", { origem: g.origem }), { familia: "Montserrat", licenca: "Google Fonts (SIL Open Font License ou Apache 2.0)" });
    const eventos: number[] = [];
    const arquivos = await baixarDoGoogleFonts("Montserrat", pasta, { origem: g.origem, aoAvancar: (_e, f) => eventos.push(f) });
    assert.deepEqual(arquivos.map((a) => path.basename(a)).sort(), ["Montserrat-400-latin-ext.woff2", "Montserrat-400-latin.woff2", "Montserrat-700-latin-ext.woff2", "Montserrat-700-latin.woff2"]);
    for (const a of arquivos) assert.match(readFileSync(a, "utf8"), /^fonte \/s\/montserrat\//);
    assert.ok(!g.pedidos.some((p) => p.includes("cyrillic")), "subconjuntos que não servem não são baixados");
    for (let i = 1; i < eventos.length; i++) assert.ok(eventos[i] >= eventos[i - 1]);
    assert.equal(eventos.at(-1), 1);
  } finally {
    await g.fechar();
  }
});

test("fonte que não está no Google Fonts → null", async () => {
  const g = await googleFalso();
  try {
    assert.equal(await procurarNoGoogleFonts("Fonte Proprietária da Marca", { origem: g.origem }), null);
  } finally {
    await g.fechar();
  }
});

test("sem internet: erro sem-conexao e nada fica na pasta", async () => {
  const g = await googleFalso();
  const origem = g.origem;
  await g.fechar();
  const pasta = mkdtempSync(path.join(os.tmpdir(), "iaev-fontes-"));
  temporarias.push(pasta);
  await assert.rejects(procurarNoGoogleFonts("Montserrat", { origem }), (e: Error & { codigo?: string }) => e.codigo === "sem-conexao" && /internet/.test(e.message));
  await assert.rejects(baixarDoGoogleFonts("Montserrat", pasta, { origem, aoAvancar: () => undefined }), (e: Error & { codigo?: string }) => e.codigo === "sem-conexao");
  assert.deepEqual(existsSync(pasta) ? readdirSync(pasta) : [], []);
});
