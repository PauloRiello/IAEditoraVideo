// Testes da memória persistente e do aprendizado controlado. Executar: npm test

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { NaoEncontrado } from "../../src/dominio/erros.ts";
import { CATEGORIAS_EDICAO, type CategoriaEdicao } from "../../src/dominio/memoria.ts";
import { MIGRACOES, VERSAO_ESQUEMA } from "../../src/infra/banco.ts";
import { montarCaminhos } from "../../src/infra/caminhos.ts";
import { Aplicacao } from "../../src/nucleo/aplicacao.ts";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const temporarias: string[] = [];
const caminhosNovos = () => {
  const pasta = mkdtempSync(path.join(os.tmpdir(), "iaev-memoria-"));
  temporarias.push(pasta);
  return montarCaminhos(path.join(pasta, "dados"), path.join(pasta, "biblioteca"), RAIZ);
};
/** Executa o teste com uma aplicação isolada e a encerra ao final. */
async function comApp(teste: (app: Aplicacao) => void | Promise<void>, caminhos = caminhosNovos()): Promise<void> {
  const app = new Aplicacao(caminhos);
  try {
    await teste(app);
  } finally {
    app.encerrar();
  }
}
const CORTE_RAPIDO = { categoria: "ritmo" as const, chave: "cortes-por-minuto", descricao: "Cortes rápidos, cerca de 40 por minuto", valor: 40 };

after(() => {
  for (const pasta of temporarias) rmSync(pasta, { recursive: true, force: true });
});

test("uma correção isolada vale só para o projeto; repetida em outro projeto, vira regra do perfil", () =>
  comApp((app) => {
    const a = app.criarProjeto("Servidor A", "fivem");
    const b = app.criarProjeto("Servidor B", "fivem");
    const c = app.criarProjeto("Servidor C", "fivem");
    const outroPerfil = app.criarProjeto("Empresa", "institucional");

    const primeira = app.aprendizado.registrarCorrecao(a.id, CORTE_RAPIDO);
    assert.equal(primeira.doProjeto.estado, "ativo");
    assert.equal(primeira.daEspecializacao.estado, "candidato");
    assert.equal(primeira.daEspecializacao.confianca, 0.33);
    assert.equal(app.aprendizadosDoProjeto(a.id).aplicaveis.length, 1, "vale no projeto corrigido");
    assert.equal(app.aprendizadosDoProjeto(c.id).aplicaveis.length, 0, "não vale em outro projeto do mesmo perfil");

    // A mesma correção de novo no mesmo projeto não conta como segundo projeto.
    assert.equal(app.aprendizado.registrarCorrecao(a.id, CORTE_RAPIDO).daEspecializacao.estado, "candidato");

    const segunda = app.aprendizado.registrarCorrecao(b.id, CORTE_RAPIDO).daEspecializacao;
    assert.equal(segunda.estado, "ativo");
    assert.equal(segunda.projetosObservados, 2);
    assert.equal(segunda.evidencias, 3);
    assert.deepEqual(app.aprendizadosDoProjeto(c.id).aplicaveis.map((x) => x.id), [segunda.id], "agora vale para o perfil");
    assert.equal(app.aprendizadosDoProjeto(outroPerfil.id).aplicaveis.length, 0, "não vira regra universal");
    assert.equal(app.aprendizado.listar({ escopo: "geral" }).length, 0);

    const origens = app.aprendizado.evidencias(segunda.id);
    assert.deepEqual(origens.map((e) => e.origem), ["correcao", "correcao", "correcao"]);
    assert.deepEqual([...new Set(origens.map((e) => e.projetoId))], [a.id, b.id], "guarda em quais projetos foi observado");
  }));

test("regra geral exige três projetos distintos; instrução explícita do usuário vale na hora", () =>
  comApp((app) => {
    const projetos = ["P1", "P2", "P3"].map((nome) => app.criarProjeto(nome));
    const observacao = {
      escopo: "geral" as const, categoria: "legendas" as const, chave: "posicao", descricao: "Legendas no terço inferior",
      valor: "inferior", origem: "analise" as const,
    };
    assert.equal(app.aprendizado.observar({ ...observacao, projetoObservado: projetos[0].id }).estado, "candidato");
    assert.equal(app.aprendizado.observar({ ...observacao, projetoObservado: projetos[1].id }).estado, "candidato");
    const terceira = app.aprendizado.observar({ ...observacao, projetoObservado: projetos[2].id });
    assert.equal(terceira.estado, "ativo");
    assert.equal(terceira.confianca, 0.6);

    const explicita = app.aprendizado.observar({
      escopo: "geral", categoria: "cta", chave: "encerramento", descricao: "Sempre terminar com chamada para o Discord",
      valor: "discord", origem: "usuario", contexto: "Vídeos de divulgação",
    });
    assert.equal(explicita.estado, "ativo");
    assert.equal(explicita.contexto, "Vídeos de divulgação");
    assert.ok(explicita.criadoEm && explicita.atualizadoEm);
  }));

test("prevalece o mais específico: temporária > projeto > especialização > geral; a temporária expira", () =>
  comApp((app) => {
    const projeto = app.criarProjeto("Trailer", "fivem");
    const base = { categoria: "transicoes" as const, chave: "tipo", origem: "usuario" as const };
    const valorAplicado = () => app.aprendizadosDoProjeto(projeto.id).aplicaveis.find((x) => x.chave === "tipo")?.valor;

    app.aprendizado.observar({ ...base, escopo: "geral", descricao: "Corte seco", valor: "corte-seco" });
    assert.equal(valorAplicado(), "corte-seco");
    app.aprendizado.observar({ ...base, escopo: "especializacao", perfil: "fivem", descricao: "Glitch", valor: "glitch" });
    assert.equal(valorAplicado(), "glitch");
    app.aprendizado.observar({ ...base, escopo: "projeto", projetoId: projeto.id, descricao: "Zoom", valor: "zoom" });
    assert.equal(valorAplicado(), "zoom");
    app.aprendizado.observar({
      ...base, escopo: "temporaria", projetoId: projeto.id, descricao: "Só neste vídeo: fade", valor: "fade",
      expiraEm: new Date(Date.now() + 60_000).toISOString(),
    });
    assert.equal(valorAplicado(), "fade");

    const vencida = app.aprendizado.observar({
      ...base, escopo: "temporaria", chave: "outra", descricao: "Já venceu", valor: 1, expiraEm: new Date(Date.now() - 1000).toISOString(),
    });
    assert.ok(!app.aprendizadosDoProjeto(projeto.id).aplicaveis.some((x) => x.id === vencida.id), "vencida não é aplicada");
    assert.equal(app.aprendizado.limparExpirados(), 1);
    assert.throws(() => app.aprendizado.obter(vencida.id), NaoEncontrado);
  }));

test("perfis combinados: preferências incompatíveis não se misturam sozinhas", () =>
  comApp((app) => {
    const projeto = app.criarProjeto("Divulgação", "fivem");
    const regra = (perfil: string, chave: string, valor: unknown) =>
      app.aprendizado.observar({
        escopo: "especializacao", perfil, categoria: "duracao-planos", chave, descricao: `${perfil}: ${chave} = ${valor}`, valor, origem: "usuario",
      });
    regra("fivem", "media-seg", 1.2);
    regra("redes-sociais", "media-seg", 2.5); // incompatível com fivem
    regra("fivem", "maxima-seg", 4);
    regra("redes-sociais", "maxima-seg", 4); // compatível
    regra("redes-sociais", "minima-seg", 0.5); // só um perfil opina

    assert.equal(app.aprendizadosDoProjeto(projeto.id).aplicaveis.length, 2, "sem combinar, só o perfil do projeto");

    const combinado = app.aprendizadosDoProjeto(projeto.id, ["redes-sociais"]);
    assert.deepEqual(combinado.aplicaveis.map((x) => x.chave), ["maxima-seg", "minima-seg"]);
    assert.equal(combinado.conflitos.length, 1);
    assert.equal(combinado.conflitos[0].chave, "media-seg");
    assert.deepEqual(combinado.conflitos[0].opcoes.map((x) => x.valor), [1.2, 2.5]);

    const porOrdem = app.aprendizadosDoProjeto(projeto.id, ["redes-sociais"], true);
    assert.equal(porOrdem.conflitos.length, 0);
    assert.equal(porOrdem.aplicaveis.find((x) => x.chave === "media-seg")?.valor, 1.2, "a pedido, o primeiro perfil prevalece");

    const perfis = app.perfis.combinar(["fivem", "institucional"]);
    assert.equal(perfis.perfil.formatoPadrao, "vertical-1080");
    assert.equal(perfis.divergencias.length, 1, "formatos padrão diferentes são avisados");
    assert.ok(perfis.perfil.diretrizes.every((d) => d.startsWith("[fivem]") || d.startsWith("[institucional]")));
  }));

test("revisar, corrigir, desativar, reativar e excluir aprendizados", () =>
  comApp((app) => {
    const a = app.criarProjeto("A", "redm");
    const b = app.criarProjeto("B", "redm");
    app.aprendizado.registrarCorrecao(a.id, CORTE_RAPIDO);
    const regra = app.aprendizado.registrarCorrecao(b.id, CORTE_RAPIDO).daEspecializacao;
    assert.equal(regra.estado, "ativo");

    const corrigida = app.aprendizado.corrigir(regra.id, { descricao: "Cortes rápidos, 35 por minuto", valor: 35, contexto: "Cenas de ação" });
    assert.deepEqual([corrigida.descricao, corrigida.valor, corrigida.contexto], ["Cortes rápidos, 35 por minuto", 35, "Cenas de ação"]);

    assert.equal(app.aprendizado.desativar(regra.id).estado, "desativado");
    assert.equal(app.aprendizadosDoProjeto(a.id).aplicaveis.some((x) => x.id === regra.id), false);
    const c = app.criarProjeto("C", "redm");
    app.aprendizado.observar({ ...CORTE_RAPIDO, valor: 35, escopo: "especializacao", perfil: "redm", origem: "correcao", projetoObservado: c.id });
    assert.equal(app.aprendizado.obter(regra.id).estado, "desativado", "novas evidências não reativam o que o usuário desativou");
    assert.equal(app.aprendizado.ativar(regra.id).estado, "ativo");

    // Um valor diferente observado enfraquece o aprendizado anterior do mesmo dono.
    const antes = app.aprendizado.obter(regra.id).confianca;
    app.aprendizado.observar({ ...CORTE_RAPIDO, valor: 20, escopo: "especializacao", perfil: "redm", origem: "correcao", projetoObservado: c.id });
    const depois = app.aprendizado.obter(regra.id);
    assert.ok(depois.confianca < antes);
    assert.equal(depois.contrarias, 1);
    for (let i = 0; i < 8; i += 1) app.aprendizado.contradizer(regra.id, { origem: "feedback", detalhe: "Usuário rejeitou" });
    assert.equal(app.aprendizado.obter(regra.id).estado, "candidato", "contestado além das confirmações, deixa de ser aplicado");

    assert.equal(app.aprendizado.listar({ perfil: "redm", estado: "candidato" }).length, 2);
    app.aprendizado.excluir(regra.id);
    assert.throws(() => app.aprendizado.obter(regra.id), NaoEncontrado);
    assert.equal(app.aprendizado.evidencias(regra.id).length, 0, "excluir remove também as evidências");
  }));

test("todas as categorias de edição são aceitas e as desconhecidas são recusadas", () =>
  comApp((app) => {
    assert.equal(CATEGORIAS_EDICAO.length, 20);
    for (const categoria of CATEGORIAS_EDICAO) {
      app.aprendizado.observar({ escopo: "geral", categoria, chave: "teste", descricao: `Sobre ${categoria}`, origem: "usuario" });
    }
    assert.equal(app.aprendizado.listar({ estado: "ativo" }).length, 20);
    assert.throws(() =>
      app.aprendizado.observar({ escopo: "geral", categoria: "culinaria" as CategoriaEdicao, chave: "x", descricao: "y", origem: "usuario" }),
    );
    assert.throws(() => app.aprendizado.observar({ escopo: "especializacao", categoria: "ritmo", chave: "x", descricao: "y", origem: "usuario" }));
  }));

test("referências, análises, planos versionados e uso de IA persistem; vídeos não entram no banco", async () => {
  const caminhos = caminhosNovos();
  let projetoId = "";
  let referenciaId = "";
  await comApp((app) => {
    const projeto = app.criarProjeto("Trailer", "fivem");
    projetoId = projeto.id;
    const midia = app.projetos.registrarMidia(projeto.id, "bruto", "D:\\Videos Brutos\\cena.mp4");
    const referencia = app.acervo.adicionarReferencia({
      titulo: "Trailer de referência", origemUrl: "https://exemplo.com/video", perfil: "fivem", autorizacao: "Cedido pelo autor",
    });
    referenciaId = referencia.id;
    app.acervo.vincularReferencia(projeto.id, referencia.id);
    app.acervo.vincularReferencia(projeto.id, referencia.id); // repetir não duplica
    assert.throws(() => app.acervo.adicionarReferencia({ titulo: "Sem origem" }));

    app.acervo.registrarAnalise({ referenciaId: referencia.id }, "ritmo", { cortesPorMinuto: 42, duracaoMediaPlanoSeg: 1.4 });
    app.acervo.registrarAnalise({ midiaId: midia.id }, "cenas", [{ inicioSeg: 0, fimSeg: 3.2 }]);
    app.acervo.registrarAnalise({ midiaId: midia.id }, "cenas", [{ inicioSeg: 0, fimSeg: 3.0 }]);

    app.acervo.salvarPlano(projeto.id, { clipes: 3 }, "ia", "Primeira proposta");
    app.acervo.salvarPlano(projeto.id, { clipes: 5 }, "usuario", "Mais cortes");
    assert.equal(app.acervo.restaurarPlano(projeto.id, 1).versao, 3);

    app.acervo.registrarUsoIA({
      projetoId: projeto.id, provedor: "whisper-local", modelo: "small", origem: "local", capacidade: "transcricao",
      operacao: "transcrever", dispositivo: "cpu", duracaoMs: 5300, sucesso: true,
    });
  }, caminhos);

  await comApp((app) => {
    assert.equal(app.acervo.referencias(projetoId).length, 1);
    assert.equal(app.acervo.referencias()[0].autorizacao, "Cedido pelo autor");
    assert.deepEqual(app.acervo.analises({ referenciaId }, "ritmo")[0].resultado, { cortesPorMinuto: 42, duracaoMediaPlanoSeg: 1.4 });
    const midia = app.projetos.midias(projetoId)[0];
    assert.deepEqual(app.acervo.analises({ midiaId: midia.id })[0].resultado, [{ inicioSeg: 0, fimSeg: 3.0 }], "a mais recente vem primeiro");

    const historico = app.acervo.historicoDePlanos(projetoId);
    assert.deepEqual(historico.map((v) => [v.versao, v.autor]), [[1, "ia"], [2, "usuario"], [3, "usuario"]]);
    assert.deepEqual(app.acervo.plano(projetoId).plano, { clipes: 3 }, "a versão atual é a restaurada");
    assert.deepEqual(app.acervo.plano(projetoId, 2).plano, { clipes: 5 }, "versões antigas continuam intactas");
    assert.equal(app.acervo.usosIA(projetoId)[0].modelo, "small");

    app.acervo.removerReferencia(referenciaId);
    assert.equal(app.acervo.analises({ referenciaId }).length, 0);
  }, caminhos);

  // O esquema não tem nenhuma coluna binária: só caminhos, metadados e resultados.
  const banco = new DatabaseSync(caminhos.banco);
  const colunas = banco.prepare("SELECT m.name AS tabela, p.type AS tipo FROM sqlite_master m, pragma_table_info(m.name) p WHERE m.type = 'table'").all() as { tipo: string }[];
  banco.close();
  assert.ok(colunas.length > 40);
  assert.equal(colunas.filter((c) => /blob/i.test(c.tipo)).length, 0);
});

test("atualização do programa: banco da versão 1 é migrado sem perder dados, com cópia prévia", async () => {
  const caminhos = caminhosNovos();
  mkdirSync(path.dirname(caminhos.banco), { recursive: true });
  const antigo = new DatabaseSync(caminhos.banco);
  antigo.exec(MIGRACOES[0]);
  antigo.exec("PRAGMA user_version = 1");
  antigo.exec("INSERT INTO projetos VALUES ('p1', 'Projeto antigo', 'geral', 'horizontal-1080', '2026-01-01', '2026-01-01')");
  antigo.exec("INSERT INTO memoria VALUES ('preferencias', 'ritmo', '\"rapido\"', '2026-01-01')");
  antigo.close();

  await comApp(async (app) => {
    assert.equal((await app.situacao()).versaoEsquema, VERSAO_ESQUEMA);
    assert.equal(app.projetos.obter("p1").nome, "Projeto antigo");
    assert.equal(app.memoria.recordar("preferencias", "ritmo"), "rapido");
    app.aprendizado.registrarCorrecao("p1", CORTE_RAPIDO); // tabelas novas utilizáveis
    assert.ok(app.copias().some((c) => c.motivo === "pre-migracao"));
    assert.ok(app.avisos.some((aviso) => aviso.includes("atualizado da versão 1")));
  }, caminhos);
});

test("backup e restauração devolvem banco e configurações ao estado da cópia, de forma reversível", () =>
  comApp((app) => {
    const projeto = app.criarProjeto("Antes da cópia", "fivem");
    app.aprendizado.registrarCorrecao(projeto.id, CORTE_RAPIDO);
    app.configuracoes.perfilPadrao = "fivem";
    app.salvarConfiguracoes();
    const copia = app.copiaDeSeguranca();
    assert.equal(copia.motivo, "manual");

    app.criarProjeto("Depois da cópia");
    app.projetos.remover(projeto.id);
    app.configuracoes.perfilPadrao = "youtube";
    app.salvarConfiguracoes();

    const anterior = app.restaurar(copia.nome);
    assert.deepEqual(app.projetos.listar().map((p) => p.nome), ["Antes da cópia"]);
    assert.equal(app.aprendizado.listar().length, 2);
    assert.equal(app.configuracoes.perfilPadrao, "fivem");
    assert.equal(anterior.motivo, "pre-restauracao");

    app.restaurar(anterior.nome); // desfaz a restauração
    assert.deepEqual(app.projetos.listar().map((p) => p.nome), ["Depois da cópia"]);
    assert.equal(app.configuracoes.perfilPadrao, "youtube");
    assert.throws(() => app.restaurar("nao-existe"), NaoEncontrado);

    // Uma cópia danificada é recusada e o banco atual permanece intacto.
    writeFileSync(path.join(copia.pasta, "editora.db"), "isto não é um banco");
    assert.throws(() => app.restaurar(copia.nome));
    assert.deepEqual(app.projetos.listar().map((p) => p.nome), ["Depois da cópia"]);
  }));

test("recuperação após falha: banco corrompido é preservado à parte e a última cópia válida é restaurada", async () => {
  const caminhos = caminhosNovos();
  await comApp((app) => {
    app.criarProjeto("Projeto salvo");
    app.copiaDeSeguranca();
    app.criarProjeto("Criado depois da cópia");
  }, caminhos);
  for (const sufixo of ["-wal", "-shm"]) rmSync(`${caminhos.banco}${sufixo}`, { force: true });
  writeFileSync(caminhos.banco, "arquivo destruído por uma falha de disco");
  writeFileSync(caminhos.configuracoes, "{ json quebrado");

  await comApp((app) => {
    assert.deepEqual(app.projetos.listar().map((p) => p.nome), ["Projeto salvo"]);
    assert.ok(app.avisos.some((aviso) => aviso.includes("Banco corrompido")));
    assert.ok(app.avisos.some((aviso) => aviso.includes("Configurações ilegíveis")));
    assert.equal(app.configuracoes.perfilPadrao, "geral");
    const pasta = readdirSync(path.dirname(caminhos.banco));
    assert.ok(pasta.some((nome) => nome.includes(".corrompido-")), "o arquivo danificado não é apagado");
  }, caminhos);

  // Sem nenhuma cópia: a aplicação ainda abre, com um banco novo.
  const semCopias = caminhosNovos();
  mkdirSync(path.dirname(semCopias.banco), { recursive: true });
  writeFileSync(semCopias.banco, "lixo");
  await comApp((app) => {
    assert.equal(app.projetos.listar().length, 0);
    assert.ok(app.avisos.some((aviso) => aviso.includes("sem cópia de segurança")));
  }, semCopias);
});

test("cópia automática ao abrir, com rotação, e execuções interrompidas são encerradas", async () => {
  const caminhos = caminhosNovos();
  let projetoId = "";
  await comApp((app) => {
    assert.equal(app.copias().length, 0, "banco recém-criado não gera cópia");
    projetoId = app.criarProjeto("P").id;
    app.configuracoes.backup = { automatico: true, intervaloHoras: 0, manter: 2 };
    app.salvarConfiguracoes();
  }, caminhos);

  // Simula um fechamento à força no meio de uma etapa.
  const banco = new DatabaseSync(caminhos.banco);
  banco.prepare("INSERT INTO execucoes (projeto_id, etapa, estado, iniciado_em) VALUES (?, 'rendering', 'executando', '2026-01-01')").run(projetoId);
  banco.close();

  for (let i = 0; i < 4; i += 1) await comApp(() => {}, caminhos);
  await comApp((app) => {
    const automaticas = app.copias().filter((c) => c.motivo === "automatica");
    assert.equal(automaticas.length, 2, "só as mais recentes são mantidas");
    const manual = app.copiaDeSeguranca();
    assert.ok(existsSync(path.join(manual.pasta, "configuracoes.json")));
  }, caminhos);

  const conferir = new DatabaseSync(caminhos.banco);
  const execucao = conferir.prepare("SELECT estado, erro FROM execucoes").get() as { estado: string; erro: string };
  conferir.close();
  assert.equal(execucao.estado, "falhou");
  assert.match(execucao.erro, /Interrompida/);
});
