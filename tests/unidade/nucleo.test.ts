// Testes da estrutura central. Executar: npm test

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { CapacidadeIndisponivel, NaoEncontrado } from "../../src/dominio/erros.ts";
import type { EtapaId, EtapaPipeline } from "../../src/dominio/pipeline.ts";
import type { ProvedorIA } from "../../src/dominio/provedores.ts";
import { abrirBanco, VERSAO_ESQUEMA } from "../../src/infra/banco.ts";
import { caminhosPadrao, montarCaminhos } from "../../src/infra/caminhos.ts";
import { carregarConfiguracoes } from "../../src/infra/configuracoes.ts";
import { Aplicacao } from "../../src/nucleo/aplicacao.ts";
import { ProvedorCompativelOpenAI, RegistroProvedores } from "../../src/servicos/provedores.ts";
import { GerenciadorVram } from "../../src/servicos/recursos.ts";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const temporarias: string[] = [];

/** Aplicação isolada em pasta temporária, usando os perfis do repositório. */
function novaPasta(): string {
  const pasta = mkdtempSync(path.join(os.tmpdir(), "iaev-teste-"));
  temporarias.push(pasta);
  return pasta;
}
const caminhosDe = (pasta: string) => montarCaminhos(path.join(pasta, "dados"), path.join(pasta, "biblioteca"), RAIZ);

after(() => {
  for (const pasta of temporarias) rmSync(pasta, { recursive: true, force: true });
});

test("a aplicação abre sem nenhum provedor de IA e cria a estrutura de pastas", async () => {
  const pasta = novaPasta();
  const app = new Aplicacao(caminhosDe(pasta));
  try {
    const s = await app.situacao();
    assert.equal(s.provedores.length, 0);
    assert.equal(s.versaoEsquema, VERSAO_ESQUEMA);
    assert.deepEqual(s.perfis.sort(), ["documentario", "fivem", "geral", "institucional", "publicidade", "redes-sociais", "redm", "youtube"]);
    for (const nome of ["Videos Brutos", "Referências", "Exportações"]) {
      assert.ok(existsSync(path.join(pasta, "biblioteca", nome)), nome);
    }
    for (const nome of ["banco", "config", "projetos", "temp", "backups", "modelos", "logs"]) {
      assert.ok(existsSync(path.join(pasta, "dados", nome)), nome);
    }
    await assert.rejects(app.provedores.selecionar("texto"), CapacidadeIndisponivel);
  } finally {
    app.encerrar();
  }
});

test("projetos, mídias, memória e feedback sobrevivem ao fechamento da aplicação", () => {
  const caminhos = caminhosDe(novaPasta());
  let app = new Aplicacao(caminhos);
  const projeto = app.criarProjeto("Trailer do servidor", "fivem");
  assert.equal(projeto.formato, "vertical-1080");
  app.projetos.registrarMidia(projeto.id, "bruto", "C:\\Videos Brutos\\cena 01.mp4", { duracaoSeg: 12.5 });
  app.memoria.lembrar("preferencias", "ritmo", { cortesPorMinuto: 40 });
  app.aprendizado.registrarFeedback(projeto.id, 4, "Bom ritmo, música alta demais");
  app.configuracoes.perfilPadrao = "redm";
  app.salvarConfiguracoes();
  app.encerrar();
  app.encerrar(); // encerrar duas vezes não causa erro

  app = new Aplicacao(caminhos);
  try {
    assert.equal(app.projetos.obter(projeto.id).nome, "Trailer do servidor");
    assert.deepEqual(app.projetos.midias(projeto.id, "bruto")[0].metadados, { duracaoSeg: 12.5 });
    assert.deepEqual(app.memoria.recordar("preferencias", "ritmo"), { cortesPorMinuto: 40 });
    assert.equal(app.aprendizado.feedbacks(projeto.id)[0].nota, 4);
    assert.equal(app.configuracoes.perfilPadrao, "redm");
    assert.throws(() => app.projetos.obter("inexistente"), NaoEncontrado);
    assert.throws(() => app.criarProjeto("X", "perfil-que-nao-existe"), NaoEncontrado);

    app.projetos.remover(projeto.id);
    assert.equal(app.projetos.midias(projeto.id).length, 0, "remover o projeto remove seus registros");
  } finally {
    app.encerrar();
  }
});

test("a cópia de segurança é um banco íntegro e independente", () => {
  const app = new Aplicacao(caminhosDe(novaPasta()));
  try {
    app.criarProjeto("Projeto A");
    const copia = app.copiaDeSeguranca();
    app.criarProjeto("Projeto B");

    const banco = abrirBanco(path.join(copia.pasta, "editora.db"));
    const nomes = (banco.prepare("SELECT nome FROM projetos").all() as { nome: string }[]).map((l) => l.nome);
    banco.close();
    assert.deepEqual(nomes, ["Projeto A"]);
  } finally {
    app.encerrar();
  }
});

test("configurações antigas ou incompletas recebem os valores padrão", () => {
  const arquivo = path.join(novaPasta(), "configuracoes.json");
  writeFileSync(arquivo, JSON.stringify({ perfilPadrao: "fivem", ia: { permitirExternos: true } }));
  const c = carregarConfiguracoes(arquivo);
  assert.equal(c.perfilPadrao, "fivem");
  assert.equal(c.ia.permitirExternos, true);
  assert.equal(c.ia.preferirLocal, true);
  assert.equal(c.processamento.margemVramMB, 1024);
});

test("o modo instalado separa dados (LOCALAPPDATA) e mídias (Documentos) do programa", () => {
  const c = caminhosPadrao({ IAEV_INSTALADO: "1", LOCALAPPDATA: path.join("C:", "Users", "u", "AppData", "Local") });
  assert.ok(c.banco.includes(path.join("AppData", "Local", "IAEditoraVideo", "banco")));
  assert.ok(c.brutos.endsWith(path.join("IA Editora de Vídeo", "Videos Brutos")));
  assert.ok(!c.dados.startsWith(c.programa));
  const personalizado = caminhosPadrao({ IAEV_DADOS: "/d", IAEV_BIBLIOTECA: "/b" });
  assert.equal(personalizado.dados, "/d");
  assert.equal(personalizado.exportacoes, path.join("/b", "Exportações"));
});

test("o orquestrador executa em ordem, persiste resultados e refaz só o intervalo pedido", async () => {
  const app = new Aplicacao(caminhosDe(novaPasta()));
  try {
    const chamadas: string[] = [];
    const etapa = (id: EtapaId, executar: EtapaPipeline["executar"]): EtapaPipeline => ({ id, descricao: id, executar });
    // Registradas fora de ordem de propósito.
    app.orquestrador.registrar(etapa("editing", async (ctx) => {
      chamadas.push("editing");
      return { cortes: (ctx.resultados.analysis as { cenas: number }).cenas * 2 };
    }));
    app.orquestrador.registrar(etapa("ingestion", async () => { chamadas.push("ingestion"); return { arquivos: 3 }; }));
    app.orquestrador.registrar(etapa("analysis", async (ctx) => {
      chamadas.push("analysis");
      return { cenas: (ctx.resultados.ingestion as { arquivos: number }).arquivos + 1 };
    }));

    const projeto = app.criarProjeto("Pipeline");
    const eventos: string[] = [];
    app.eventos.on("etapa:concluida", (e: { etapa: string }) => eventos.push(e.etapa));

    const execucoes = await app.executarPipeline(projeto.id);
    assert.deepEqual(chamadas, ["ingestion", "analysis", "editing"]);
    assert.deepEqual(eventos, ["ingestion", "analysis", "editing"]);
    assert.deepEqual(execucoes.at(-1), { etapa: "editing", estado: "concluida", resultado: { cortes: 8 } });

    chamadas.length = 0;
    await app.executarPipeline(projeto.id, { de: "editing", ate: "editing" });
    assert.deepEqual(chamadas, ["editing"], "etapas anteriores não são refeitas");

    app.orquestrador.registrar(etapa("rendering", async () => { throw new Error("sem espaço em disco"); }));
    app.orquestrador.registrar(etapa("quality-control", async () => { chamadas.push("quality-control"); }));
    const comFalha = await app.executarPipeline(projeto.id, { de: "rendering" });
    assert.deepEqual(comFalha, [{ etapa: "rendering", estado: "falhou", erro: "sem espaço em disco" }]);
    assert.ok(!chamadas.includes("quality-control"), "o pipeline para na primeira falha");
  } finally {
    app.encerrar();
  }
});

test("provedores: locais têm prioridade e externos só entram com permissão", async () => {
  const falso = (id: string, origem: ProvedorIA["origem"], disponivel = true): ProvedorIA => ({
    id, nome: id, origem, capacidades: ["texto"], disponivel: async () => disponivel,
  });

  const restrito = new RegistroProvedores({ preferirLocal: true, permitirExternos: false });
  restrito.registrar(falso("api", "externo"));
  await assert.rejects(restrito.selecionar("texto"), CapacidadeIndisponivel);

  const aberto = new RegistroProvedores({ preferirLocal: true, permitirExternos: true });
  aberto.registrar(falso("api", "externo"));
  aberto.registrar(falso("ollama", "local"));
  assert.equal((await aberto.selecionar("texto")).id, "ollama");
  await assert.rejects(aberto.selecionar("visao"), CapacidadeIndisponivel);

  const comQueda = new RegistroProvedores({ preferirLocal: true, permitirExternos: true });
  comQueda.registrar(falso("ollama", "local", false));
  comQueda.registrar(falso("api", "externo"));
  assert.equal((await comQueda.selecionar("texto")).id, "api", "local fora do ar: usa o externo permitido");
});

test("provedor compatível com OpenAI conversa com um servidor local", async () => {
  const servidor = createServer((pedido, resposta) => {
    resposta.setHeader("content-type", "application/json");
    if (pedido.url === "/v1/models") resposta.end(JSON.stringify({ data: [] }));
    else resposta.end(JSON.stringify({ choices: [{ message: { content: "plano pronto" } }] }));
  });
  await new Promise<void>((pronto) => servidor.listen(0, "127.0.0.1", pronto));
  const porta = (servidor.address() as AddressInfo).port;
  const config = {
    id: "local", nome: "Servidor local", tipo: "compativel-openai" as const, origem: "local" as const,
    urlBase: `http://127.0.0.1:${porta}/v1/`, modelo: "teste", capacidades: ["texto" as const], ativo: true,
  };
  try {
    const provedor = new ProvedorCompativelOpenAI(config);
    assert.equal(await provedor.disponivel(), true);
    assert.equal(await provedor.gerarTexto({ mensagem: "planeje" }), "plano pronto");

    const semChave = new ProvedorCompativelOpenAI({ ...config, variavelChave: "CHAVE_QUE_NAO_EXISTE" }, {});
    assert.equal(await semChave.disponivel(), false, "sem a chave configurada, fica indisponível sem lançar erro");
  } finally {
    servidor.close();
  }
  const foraDoAr = new ProvedorCompativelOpenAI({ ...config, urlBase: "http://127.0.0.1:9/v1" });
  assert.equal(await foraDoAr.disponivel(), false);
});

test("VRAM: modelo que não cabe vai para a CPU; sem GPU NVIDIA tudo vai para a CPU", () => {
  const vram = new GerenciadorVram({ fabricante: "nvidia", nome: "RTX 3060", vramMB: 12288 }, 1024);
  assert.equal(vram.livreMB, 11264);
  assert.equal(vram.reservar("whisper-large", 6000), "gpu");
  assert.equal(vram.reservar("llm-local", 8000), "cpu", "não cabe junto com o que já está carregado");
  assert.equal(vram.reservar("visao", 4000), "gpu");
  vram.liberar("whisper-large");
  assert.equal(vram.reservar("llm-local", 6000), "gpu");

  assert.equal(new GerenciadorVram(null, 1024).reservar("whisper", 500), "cpu");
  assert.equal(new GerenciadorVram({ fabricante: "amd", nome: "RX", vramMB: 8192 }, 1024).reservar("whisper", 500), "cpu");
});

test("independência: o código da aplicação não depende de Claude nem da Anthropic", () => {
  const pacote = JSON.parse(readFileSync(path.join(RAIZ, "package.json"), "utf8")) as { dependencies: Record<string, string> };
  assert.deepEqual(Object.keys(pacote.dependencies).filter((nome) => /anthropic|claude/i.test(nome)), []);

  const arquivos = (readdirSync(path.join(RAIZ, "src"), { recursive: true }) as string[]).filter((nome) => nome.endsWith(".ts"));
  assert.ok(arquivos.length > 0);
  for (const arquivo of arquivos) {
    const codigo = readFileSync(path.join(RAIZ, "src", arquivo), "utf8");
    assert.doesNotMatch(codigo, /anthropic|claude/i, `src/${arquivo} menciona Claude/Anthropic`);
  }
});
