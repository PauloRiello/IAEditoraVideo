// Lógica do aplicativo (invólucro Electron) que não depende do Electron.

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { ambienteDoServidor, fracaoDaAbertura, lerLinha, podeInstalarAgora, textoDaAtualizacao } from "../../aplicativo/estado.mjs";

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
  assert.deepEqual(lerLinha('{"pronta":true,"porta":47810,"token":"abc","avisos":["x"]}'), { tipo: "pronta", porta: 47810, token: "abc", avisos: ["x"] });
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
