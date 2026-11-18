// Lógica do aplicativo (invólucro Electron) que não depende do Electron.

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { ambienteDoServidor, escolherBiblioteca, fracaoDaAbertura, lerLinha, pastaDeTrabalhoDoServidor, podeInstalarAgora, textoDaAtualizacao } from "../../aplicativo/estado.mjs";

test("ambiente do servidor: roda como Node, modo anfitrião, pastas e FFmpeg do ambiente na frente do PATH", () => {
  const amb = path.join("C:", "dados", "ambiente");
  const env = ambienteDoServidor({ dados: path.join("C:", "dados"), biblioteca: path.join("C:", "bib"), ambiente: amb, pathAtual: "/usr/bin", registro: path.join("C:", "dados", "logs", "aplicativo.log") });
  assert.equal(env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(env.IAEV_ANFITRIAO, "1");
  assert.equal(env.IAEV_INSTALADO, "1");
  assert.equal(env.IAEV_DADOS, path.join("C:", "dados"));
  assert.equal(env.IAEV_BIBLIOTECA, path.join("C:", "bib"));
  assert.equal(env.IAEV_AMBIENTE, amb);
  assert.equal(env.IAEV_REGISTRO, path.join("C:", "dados", "logs", "aplicativo.log"));
  assert.equal(env.PATH, `${path.join(amb, "ferramentas", "ffmpeg", "bin")}${path.delimiter}/usr/bin`);
});

test("leitura das linhas do servidor e da preparação", () => {
  assert.deepEqual(lerLinha('{"etapa":"Abrindo os dados","fracao":0.2}'), { tipo: "etapa", etapa: "Abrindo os dados", fracao: 0.2 });
  assert.deepEqual(lerLinha('{"pronta":true,"porta":47810,"token":"abc","avisos":["x"]}'), { tipo: "pronta", porta: 47810, token: "abc", avisos: ["x"], jaAberta: false });
  assert.deepEqual(lerLinha('{"pronto":true,"faltando":["Whisper"],"avisos":[]}'), { tipo: "preparado", faltando: ["Whisper"], avisos: [] });
  assert.deepEqual(lerLinha('{"erro":"disco cheio"}'), { tipo: "erro", mensagem: "disco cheio" });
  for (const lixo of ["", "texto solto", "{", '{"outra":1}', '{"etapa":"sem fração"}', "[1,2]"]) assert.equal(lerLinha(lixo), null, lixo);
});

test("barra da abertura: preparação de 0 a 70%, abertura de 70 a 100%, nunca fora de 0 a 1", () => {
  assert.equal(fracaoDaAbertura("preparando", 0), 0);
  assert.equal(fracaoDaAbertura("preparando", 1), 0.7);
  assert.equal(fracaoDaAbertura("abrindo", 0), 0.7);
  assert.equal(fracaoDaAbertura("abrindo", 1), 1);
  assert.equal(fracaoDaAbertura("abrindo", 7), 1);
  assert.equal(fracaoDaAbertura("preparando", -1), 0);
  assert.ok(fracaoDaAbertura("preparando", 1) <= fracaoDaAbertura("abrindo", 0));
});

test("não instala atualização com render ou análise na fila ou em andamento", () => {
  assert.equal(podeInstalarAgora([]), true);
  assert.equal(podeInstalarAgora([{ estado: "concluida" }, { estado: "falhou" }, { estado: "cancelada" }]), true);
  assert.equal(podeInstalarAgora([{ estado: "concluida" }, { estado: "executando" }]), false);
  assert.equal(podeInstalarAgora([{ estado: "na-fila" }]), false);
});

test("textos da atualização, em linguagem simples", () => {
  assert.equal(textoDaAtualizacao({ tipo: "verificando" }), "Procurando atualizações…");
  assert.equal(textoDaAtualizacao({ tipo: "disponivel", versao: "0.2.0" }), "Versão 0.2.0 disponível: baixando…");
  assert.equal(textoDaAtualizacao({ tipo: "baixando", versao: "0.2.0", fracao: 0.374 }), "Baixando a versão 0.2.0: 37%");
  assert.equal(textoDaAtualizacao({ tipo: "baixada", versao: "0.2.0" }), "Versão 0.2.0 pronta. Ela é instalada ao fechar o programa, ou agora em “Reiniciar e atualizar”.");
  assert.equal(textoDaAtualizacao({ tipo: "sem-novidade" }), "Você está usando a versão mais recente.");
  assert.equal(textoDaAtualizacao({ tipo: "erro", mensagem: "net::ERR" }), "Não foi possível procurar atualizações agora. O programa tenta de novo mais tarde.");
});

test("servidor já aberto por outro inicializador: a linha pronta diz jaAberta", () => {
  assert.deepEqual(lerLinha('{"pronta":true,"porta":1,"token":"t","avisos":[],"jaAberta":true}'), { tipo: "pronta", porta: 1, token: "t", avisos: [], jaAberta: true });
  assert.equal((lerLinha('{"pronta":true,"porta":1,"token":"t","avisos":[]}') as { jaAberta?: boolean }).jaAberta, false);
});

test("pasta de vídeos: variável, escolha guardada, pasta do Instalar.cmd (sem acento) e só então a padrão", () => {
  const docs = path.join("D:", "OneDrive", "Documentos");
  const nada = () => false;
  assert.equal(escolherBiblioteca({ variavel: "X:/v", guardada: "Y:/v", documentos: docs, existe: nada }), "X:/v");
  assert.equal(escolherBiblioteca({ guardada: "Y:/v", documentos: docs, existe: nada }), "Y:/v");
  const semAcento = path.join(docs, "IA Editora de Video");
  const comAcento = path.join(docs, "IA Editora de Vídeo");
  assert.equal(escolherBiblioteca({ documentos: docs, existe: (p: string) => p === comAcento }), comAcento);
  assert.equal(escolherBiblioteca({ documentos: docs, existe: (p: string) => p === semAcento || p === comAcento }), semAcento);
  assert.equal(escolherBiblioteca({ documentos: docs, existe: nada }), semAcento, "a padrão é a mesma do Instalar.cmd");
});

test("o servidor trabalha dentro do ambiente: o navegador de render do Remotion fica lá e sobrevive às atualizações", async () => {
  const ambiente = mkdtempSync(path.join(os.tmpdir(), "iaev-cwd-"));
  try {
    assert.equal(pastaDeTrabalhoDoServidor(ambiente), ambiente);
    // Premissa sobre o Remotion: sem package.json acima da pasta de trabalho, o cache fica em <cwd>/.remotion.
    const { getDownloadsCacheDir } = await import("../../node_modules/@remotion/renderer/dist/browser/get-download-destination.js" as string) as { getDownloadsCacheDir: () => string };
    const antes = process.cwd();
    mkdirSync(path.join(ambiente, "x"));
    process.chdir(path.join(ambiente, "x"));
    try {
      assert.equal(getDownloadsCacheDir(), path.join(ambiente, "x", ".remotion"));
    } finally {
      process.chdir(antes);
    }
  } finally {
    rmSync(ambiente, { recursive: true, force: true });
  }
});
