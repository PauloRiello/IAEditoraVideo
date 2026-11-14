// Testes do feedback e do aprendizado contínuo: avaliação de edições, comparação de
// versões, correções manuais, separação de contextos, rastreabilidade, reversibilidade e
// métricas de resultado. Executar: npm test

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ErroAplicacao } from "../../src/dominio/erros.ts";
import type { ItemVideo, Operacao } from "../../src/dominio/timeline.ts";
import { montarCaminhos } from "../../src/infra/caminhos.ts";
import { Aplicacao } from "../../src/nucleo/aplicacao.ts";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const base = mkdtempSync(path.join(os.tmpdir(), "iaev-feedback-"));
const caminhos = montarCaminhos(path.join(base, "dados"), path.join(base, "biblioteca"), RAIZ);
let app: Aplicacao;

before(() => {
  mkdirSync(caminhos.brutos, { recursive: true });
  // Um vídeo bruto pequeno, com três cenas de 2 s e som.
  const R = "s=320x180:r=30";
  execFileSync("ffmpeg", [
    "-v", "error", "-y", "-f", "lavfi", "-t", "2", "-i", `testsrc2=${R}`, "-f", "lavfi", "-t", "2", "-i", `smptebars=${R}`, "-f", "lavfi", "-t", "2", "-i", `rgbtestsrc=${R}`,
    "-f", "lavfi", "-t", "6", "-i", "anoisesrc=c=pink:a=0.5:r=44100", "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-map", "3:a",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(caminhos.brutos, "material.mp4"),
  ], { stdio: "pipe" });
  app = new Aplicacao(caminhos);
});

after(() => {
  app?.encerrar();
  rmSync(base, { recursive: true, force: true });
});

/** Projeto pronto para avaliação: brutos analisados, plano aprovado e timeline montada pela IA. */
async function projetoMontado(nome: string, perfil: string): Promise<string> {
  const id = app.criarProjeto(nome, perfil).id;
  app.producao.importarBrutos(id);
  await app.producao.analisarBrutos(id, { transcrever: false });
  app.producao.planejar(id, { objetivo: `Vídeo de ${nome}`, duracaoDesejadaSeg: 6, cta: "Entre no Discord" });
  app.producao.aprovarPlano(id);
  app.edicao.montar(id);
  return id;
}
const clipes = (projetoId: string) => app.edicao.timeline(projetoId).timeline.itens.filter((i): i is ItemVideo => i.tipo === "video");
/** O usuário troca os cortes secos por transições graduais. */
const usarTransicoesGraduais = (projetoId: string) =>
  app.edicao.editar(projetoId, clipes(projetoId).slice(1).map((c): Operacao => ({ tipo: "alterar", id: c.id, campos: { entrada: { tipo: "gradual", duracaoSeg: 0.4 } } })));
const graduais = (projetoId: string) => clipes(projetoId).slice(1).filter((c) => c.entrada.tipo === "gradual").length;
const daEspecializacao = (perfil: string, chave: string) => app.aprendizado.listar({ escopo: "especializacao", perfil }).find((a) => a.chave === chave);

test("avaliar uma edição: aprovar, rejeitar, pedir alterações, notas por aspecto, motivo e trechos para revisão", async () => {
  const projeto = await projetoMontado("Avaliação", "institucional");
  assert.throws(() => app.feedback.avaliar(projeto, { decisao: "rejeitada" }), (e: unknown) => e instanceof ErroAplicacao && e.codigo === "motivo-obrigatorio");
  assert.throws(() => app.feedback.avaliar(projeto, { decisao: "alteracoes-solicitadas", motivo: "  " }), /motivo/);
  assert.throws(() => app.feedback.avaliar(projeto, { decisao: "aprovada", notas: { ritmo: 7 } }), /1 a 5/);
  assert.throws(() => app.feedback.avaliar(projeto, { decisao: "aprovada", notas: { sabor: 3 } as never }), /Aspecto desconhecido/);
  assert.throws(() => app.feedback.avaliar(projeto, { decisao: "aprovada", trechos: [{ inicioSeg: 3, fimSeg: 2, comentario: "x" }] }), /trecho/i);

  const pedido = app.feedback.avaliar(projeto, {
    decisao: "alteracoes-solicitadas", motivo: "O meio está parado demais",
    notas: { roteiro: 4, ritmo: 2, cortes: 3, efeitos: 3, audio: 4, resultado: 3 },
    trechos: [
      { inicioSeg: 2, fimSeg: 4, itemId: "clipe-2", aspecto: "ritmo", comentario: "Encurtar este plano" },
      { inicioSeg: 5, fimSeg: 6, comentario: "Texto sai cedo demais" },
    ],
  });
  assert.deepEqual([pedido.decisao, pedido.versaoDaTimeline, pedido.motivo, pedido.notas.ritmo, pedido.trechos.length], ["alteracoes-solicitadas", 1, "O meio está parado demais", 2, 2]);
  assert.deepEqual(pedido.aprendizado, { correcoes: [], confirmados: 0, contestados: 0 }, "sem aprendizado em vigor, nada é confirmado nem contestado");

  const pendentes = app.feedback.trechosEmRevisao(projeto);
  assert.deepEqual(pendentes.map((t) => [t.inicioSeg, t.fimSeg, t.itemId, t.aspecto, t.resolvido]), [[2, 4, "clipe-2", "ritmo", false], [5, 6, null, null, false]]);
  app.feedback.resolverTrecho(pendentes[0].id);
  assert.deepEqual(app.feedback.trechosEmRevisao(projeto).map((t) => t.comentario), ["Texto sai cedo demais"]);
  assert.equal(app.feedback.trechosEmRevisao(projeto, false).length, 2);

  const rejeicao = app.feedback.avaliar(projeto, { decisao: "rejeitada", motivo: "Não passa a seriedade da empresa" });
  const aprovacao = app.feedback.avaliar(projeto, { decisao: "aprovada", motivo: "Ficou no tom certo depois dos ajustes" });
  assert.deepEqual(app.feedback.avaliacoes(projeto).map((a) => [a.id, a.decisao]), [[aprovacao.id, "aprovada"], [rejeicao.id, "rejeitada"], [pedido.id, "alteracoes-solicitadas"]]);
  assert.equal(app.feedback.avaliacao(rejeicao.id).motivo, "Não passa a seriedade da empresa");
});

test("comparar versões: itens que entraram, saíram e mudaram, e os indicadores de cada versão", async () => {
  const projeto = await projetoMontado("Comparação", "institucional");
  usarTransicoesGraduais(projeto);
  app.edicao.editar(projeto, [
    { tipo: "remover", id: "texto-cta" },
    { tipo: "inserir", item: { id: "aviso", tipo: "texto", camada: 20, inicioSeg: 1, duracaoSeg: 2, texto: "Novo", posicao: "base", tamanho: 0.04, cor: "#fff", fundo: "", animacao: "surgir" } },
    { tipo: "cortar", id: "clipe-1", fimSeg: 1 },
  ]);

  const c = app.feedback.compararVersoes(projeto, 1, 3);
  assert.deepEqual([c.de, c.para], [1, 3]);
  assert.deepEqual(c.itens.adicionados, [{ id: "aviso", tipo: "texto" }]);
  assert.deepEqual(c.itens.removidos, [{ id: "texto-cta", tipo: "texto" }]);
  assert.ok(c.itens.alterados.find((i) => i.id === "clipe-2")?.campos.some((campo) => campo.campo === "entrada"));
  assert.ok(c.itens.alterados.find((i) => i.id === "clipe-1")?.campos.some((campo) => campo.campo === "duracaoSeg" && campo.de === 2 && campo.para === 1));
  assert.deepEqual([c.indicadores.de.transicoesGraduais, c.indicadores.para.transicoesGraduais, c.indicadores.de.cta, c.indicadores.para.cta], [0, 1, "texto", "nenhum"]);
  assert.ok(c.resumo.some((linha) => linha.startsWith("Fração de transições graduais: 0 → 1")));
  assert.ok(c.resumo.some((linha) => linha.startsWith("Chamada para ação: texto → nenhum")));

  const ultima = app.feedback.compararVersoes(projeto);
  assert.deepEqual([ultima.de, ultima.para], [2, 3], "sem números, compara a versão anterior com a atual");
  assert.equal(app.feedback.compararVersoes(projeto, 3, 3).resumo.length, 0);
});

test("correção manual vira aprendizado do projeto; repetida em outro projeto, vira preferência do perfil — sem vazar para outros contextos", async () => {
  const a = await projetoMontado("Servidor A", "fivem");
  const b = await projetoMontado("Servidor B", "fivem");
  assert.equal(graduais(a), 0, "a IA começa propondo cortes secos");

  // Projeto A: o usuário troca as transições à mão e aprova.
  usarTransicoesGraduais(a);
  const avaliacaoA = app.feedback.avaliar(a, { decisao: "aprovada", motivo: "Transições suaves combinam mais" });
  assert.deepEqual(avaliacaoA.aprendizado.correcoes.map((c) => [c.categoria, c.chave, c.valor, c.escopo, c.estado]), [["transicoes", "tipo-predominante", "gradual", "projeto", "ativo"]]);
  assert.match(avaliacaoA.aprendizado.correcoes[0].descricao, /a IA havia proposto "corte-seco"/);
  assert.equal(daEspecializacao("fivem", "tipo-predominante")?.estado, "candidato", "uma correção isolada não vira regra do perfil");

  // Um projeto novo do mesmo perfil ainda recebe cortes secos.
  const c = await projetoMontado("Servidor C", "fivem");
  assert.equal(graduais(c), 0);

  // Projeto B: a mesma correção aparece de novo. Agora é um padrão.
  usarTransicoesGraduais(b);
  const avaliacaoB = app.feedback.avaliar(b, { decisao: "aprovada" });
  const padrao = daEspecializacao("fivem", "tipo-predominante")!;
  assert.deepEqual([padrao.estado, padrao.valor, padrao.projetosObservados], ["ativo", "gradual", 2]);

  // Rastreabilidade: cada evidência diz de qual avaliação e de qual projeto veio.
  const evidencias = app.aprendizado.evidencias(padrao.id);
  assert.deepEqual(evidencias.map((e) => [e.origem, e.avaliacaoId, e.projetoId, e.confirma]), [["correcao", avaliacaoA.id, a, true], ["correcao", avaliacaoB.id, b, true]]);
  assert.match(evidencias[0].detalhe, /Avaliação da edição v2: aprovada — Transições suaves combinam mais/);

  // Integração com o perfil: um projeto novo de FiveM já nasce com transições graduais, e diz por quê.
  const d = await projetoMontado("Servidor D", "fivem");
  assert.equal(graduais(d), clipes(d).length - 1);
  const plano = app.acervo.plano(d).plano as { decisoes: { aspecto: string; origem: string; aprendizadoId?: number }[] };
  assert.deepEqual(plano.decisoes.find((x) => x.aspecto === "transicoes/tipo-predominante"), { aspecto: "transicoes/tipo-predominante", decisao: "gradual", origem: "aprendizado", aprendizadoId: padrao.id });
  assert.deepEqual(app.feedback.perfilAprendido("fivem")["transicoes/tipo-predominante"].valor, "gradual");

  // Separação de contextos: RedM, institucional e as preferências gerais não foram afetados.
  assert.equal(graduais(await projetoMontado("Faroeste", "redm")), 0);
  assert.equal(graduais(await projetoMontado("Empresa", "institucional")), 0);
  assert.equal(app.aprendizado.listar({ escopo: "geral" }).length, 0);
  assert.deepEqual(Object.keys(app.feedback.perfilAprendido("redm")), []);
  const painel = app.feedback.painel();
  assert.ok(painel.perfis.fivem.some((x) => x.id === padrao.id) && !painel.perfis.redm);
  assert.ok(painel.projetos[a].every((x) => x.escopo === "projeto" && x.projetoId === a));

  // Reversibilidade: desfazer a avaliação do projeto B devolve o perfil ao estado anterior.
  assert.deepEqual(app.feedback.desfazerAvaliacao(avaliacaoB.id), { aprendizadosAfetados: 2 });
  assert.equal(daEspecializacao("fivem", "tipo-predominante")?.estado, "ativo", "a aprovação do plano do projeto D, que aplicou a regra, continua valendo como segunda fonte");
  assert.equal(app.feedback.avaliacao(avaliacaoB.id).desfeita, true);
  assert.ok(!app.aprendizado.listar({ escopo: "projeto", projetoId: b }).length, "a correção do projeto B foi removida");
  assert.throws(() => app.feedback.desfazerAvaliacao(avaliacaoB.id), /já foi desfeito/);
});

test("uma correção isolada, desfeita, não deixa rastro; ajustes dentro da mesma faixa não ensinam nada", async () => {
  const unico = await projetoMontado("Único", "youtube");
  usarTransicoesGraduais(unico);
  const avaliacao = app.feedback.avaliar(unico, { decisao: "aprovada" });
  assert.equal(daEspecializacao("youtube", "tipo-predominante")?.estado, "candidato");
  app.feedback.desfazerAvaliacao(avaliacao.id);
  assert.equal(app.aprendizado.listar({ perfil: "youtube" }).length + app.aprendizado.listar({ projetoId: unico }).length, 0);

  // Encurtar um plano de 2 s para 1,8 s continua na faixa "média": não vira correção.
  const outro = await projetoMontado("Ajuste fino", "youtube");
  app.edicao.editar(outro, { tipo: "cortar", id: "clipe-2", fimSeg: 1.8 });
  assert.deepEqual(app.feedback.avaliar(outro, { decisao: "aprovada" }).aprendizado.correcoes, []);
  // Uma edição rejeitada não gera correções, mesmo com mudanças manuais.
  usarTransicoesGraduais(outro);
  assert.deepEqual(app.feedback.avaliar(outro, { decisao: "rejeitada", motivo: "Não gostei" }).aprendizado.correcoes, []);
  // Preferência declarada junto com a avaliação: vale para o projeto e fica candidata no perfil.
  const declarada = app.feedback.avaliar(outro, {
    decisao: "alteracoes-solicitadas", motivo: "Texto muito formal",
    correcoes: [{ categoria: "comunicacao", chave: "tom", valor: "informal", descricao: "Falar de forma descontraída" }],
  });
  assert.deepEqual(declarada.aprendizado.correcoes.map((x) => [x.categoria, x.valor, x.escopo]), [["comunicacao", "informal", "projeto"]]);
  assert.equal(daEspecializacao("youtube", "tom")?.estado, "candidato");
});

test("notas por aspecto: nota baixa contesta o que foi aplicado naquele aspecto; rejeição sem aspecto não ensina nada", async () => {
  const ritmo = app.aprendizado.observar({ escopo: "especializacao", perfil: "redm", categoria: "ritmo", chave: "cadencia-de-cortes", valor: "moderado", descricao: "Ritmo moderado", origem: "usuario" });
  const cor = app.aprendizado.observar({ escopo: "especializacao", perfil: "redm", categoria: "cores", chave: "saturacao", valor: "baixa", descricao: "Cores dessaturadas", origem: "usuario" });
  const projeto = await projetoMontado("Duelo", "redm");
  const estado = (id: number) => { const x = app.aprendizado.obter(id); return [x.evidencias, x.contrarias]; };
  const antes = [estado(ritmo.id), estado(cor.id)];

  const semAspecto = app.feedback.avaliar(projeto, { decisao: "rejeitada", motivo: "Não era isso" });
  assert.deepEqual([semAspecto.aprendizado.confirmados, semAspecto.aprendizado.contestados], [0, 0]);
  assert.deepEqual([estado(ritmo.id), estado(cor.id)], antes);

  const comAspecto = app.feedback.avaliar(projeto, { decisao: "rejeitada", motivo: "Arrastado", notas: { ritmo: 1, efeitos: 5 } });
  assert.deepEqual([comAspecto.aprendizado.confirmados, comAspecto.aprendizado.contestados], [1, 1]);
  assert.deepEqual(estado(ritmo.id), [antes[0][0], antes[0][1] + 1], "ritmo contestado");
  assert.deepEqual(estado(cor.id), [antes[1][0] + 1, antes[1][1]], "cor confirmada pela nota 5 em efeitos");
  assert.ok(app.aprendizado.obter(ritmo.id).confianca < ritmo.confianca);
  const evidencia = app.aprendizado.evidencias(ritmo.id).at(-1)!;
  assert.deepEqual([evidencia.avaliacaoId, evidencia.confirma, evidencia.projetoId], [comAspecto.id, false, projeto]);
  assert.match(evidencia.detalhe, /nota 1 em ritmo/);

  // Aprovação sem notas confirma tudo o que estava em vigor.
  const aprovacao = app.feedback.avaliar(projeto, { decisao: "aprovada" });
  assert.equal(aprovacao.aprendizado.confirmados, 2);
});

test("controle do usuário: toda ação sobre um aprendizado pode ser desfeita", () => {
  const original = app.aprendizado.observar({
    escopo: "especializacao", perfil: "publicidade", categoria: "tipografia", chave: "posicao-do-texto", valor: "topo", descricao: "Texto no topo", contexto: "Anúncios", origem: "usuario",
  });
  const evidencias = app.aprendizado.evidencias(original.id).length;

  app.aprendizado.corrigir(original.id, { valor: "base", descricao: "Texto na base" });
  app.aprendizado.desativar(original.id);
  app.aprendizado.excluir(original.id);
  assert.throws(() => app.aprendizado.obter(original.id));
  const acoes = app.aprendizado.acoes(original.id);
  assert.deepEqual(acoes.map((x) => x.acao), ["excluido", "desativado", "corrigido"]);

  // Desfazer a exclusão: volta desativado, já com o valor corrigido.
  const restaurado = app.aprendizado.desfazerAcao(acoes[0].id);
  assert.deepEqual([restaurado.id, restaurado.estado, restaurado.valor, app.aprendizado.evidencias(original.id).length], [original.id, "desativado", "base", evidencias]);
  // Desfazer a desativação e a correção: volta exatamente ao que era.
  assert.equal(app.aprendizado.desfazerAcao(acoes[1].id).estado, "ativo");
  const comoAntes = app.aprendizado.desfazerAcao(acoes[2].id);
  assert.deepEqual([comoAntes.valor, comoAntes.descricao, comoAntes.contexto, comoAntes.estado], ["topo", "Texto no topo", "Anúncios", "ativo"]);
  assert.throws(() => app.aprendizado.desfazerAcao(acoes[2].id), /já foi desfeita/);
  assert.ok(app.aprendizado.acoes(original.id).every((x) => x.desfeita));

  // Desativado não é aplicado; reativado volta a ser.
  app.aprendizado.desativar(original.id);
  assert.ok(!("tipografia/posicao-do-texto" in app.feedback.perfilAprendido("publicidade")));
  app.aprendizado.ativar(original.id);
  assert.equal(app.feedback.perfilAprendido("publicidade")["tipografia/posicao-do-texto"].valor, "topo");
});

test("métricas: só as informadas, sem causalidade presumida, como sinal fraco e reversível", () => {
  const projetos = Array.from({ length: 6 }, (_, i) => app.criarProjeto(`Campanha ${i + 1}`, "publicidade").id);
  const regra = app.aprendizado.listar({ perfil: "publicidade", estado: "ativo" })[0];
  const candidato = app.aprendizado.observar({ escopo: "especializacao", perfil: "publicidade", categoria: "hooks", chave: "abertura", valor: "pergunta", descricao: "Abrir com pergunta", origem: "analise", projetoObservado: projetos[0] });
  assert.equal(candidato.estado, "candidato");

  // Nada é inventado nem aceito sem base.
  assert.throws(() => app.feedback.registrarResultado(projetos[0], { plataforma: "Instagram", metricas: {} }), /ao menos uma métrica/);
  assert.throws(() => app.feedback.registrarResultado(projetos[0], { plataforma: "Instagram", metricas: { curtidas: -1 } }), /maior ou igual a zero/);
  assert.throws(() => app.feedback.registrarResultado(projetos[0], { plataforma: "Instagram", metricas: { retencaoPercentual: 140 } }), /0 a 100/);
  assert.throws(() => app.feedback.registrarResultado(projetos[0], { plataforma: "Instagram", metricas: { alcance: 10 } as never }), /desconhecida/);
  assert.throws(() => app.feedback.registrarResultado(projetos[0], { plataforma: "", metricas: { curtidas: 1 } }), /plataforma/);
  assert.throws(
    () => app.feedback.registrarResultado(projetos[0], { plataforma: "Instagram", metricas: { novosJogadores: 12 } }),
    (e: unknown) => e instanceof ErroAplicacao && e.codigo === "atribuicao-sem-evidencia",
  );

  // Os três primeiros resultados: faltam vídeos comparáveis, nada é aprendido.
  const antes = app.aprendizado.evidencias(regra.id).length;
  for (const [i, retencao] of [40, 42, 44].entries()) {
    const r = app.feedback.registrarResultado(projetos[i], { plataforma: "Instagram", metricas: { visualizacoes: 1000 * (i + 1), retencaoPercentual: retencao } });
    assert.deepEqual([r.leitura.sinal, r.leitura.comparaveis, r.leitura.aprendizadosSinalizados], ["insuficiente", i, 0]);
  }
  assert.equal(app.aprendizado.evidencias(regra.id).length, antes);

  // Quarto resultado, bem acima da mediana (42): sinal fraco a favor do que estava em vigor.
  const acima = app.feedback.registrarResultado(projetos[3], {
    plataforma: "instagram", metricas: { visualizacoes: 500, retencaoPercentual: 60, entradasNoDiscord: 9, novosJogadores: 4 },
    evidenciaDeAtribuicao: "Convite exclusivo do vídeo: 4 cadastros com o código REELS20",
  });
  assert.deepEqual([acima.leitura.sinal, acima.leitura.metrica, acima.leitura.valor, acima.leitura.referencia, acima.leitura.comparaveis, acima.leitura.aprendizadosSinalizados], ["acima", "retencaoPercentual", 60, 42, 3, 1]);
  assert.match(acima.leitura.observacao, /não prova que a edição causou/);
  assert.match(acima.leitura.observacao, /não garantem desempenho futuro/);
  assert.deepEqual([acima.metricas.novosJogadores, acima.evidenciaDeAtribuicao.includes("REELS20")], [4, true]);
  const sinal = app.aprendizado.evidencias(regra.id).at(-1)!;
  assert.deepEqual([sinal.resultadoId, sinal.peso, sinal.confirma, sinal.projetoId], [acima.id, 0.5, true, projetos[3]]);
  assert.match(sinal.detalhe, /correlação, não causa comprovada/);
  assert.equal(app.aprendizado.obter(candidato.id).evidencias, 1, "candidatos não recebem sinal de métricas");

  // Métricas nunca promovem um candidato: não contam como fonte distinta.
  app.aprendizado.confirmar(candidato.id, { origem: "feedback", projetoObservado: projetos[4], resultadoId: acima.id, peso: 0.5 });
  app.aprendizado.confirmar(candidato.id, { origem: "feedback", projetoObservado: projetos[5], resultadoId: acima.id, peso: 0.5 });
  assert.deepEqual([app.aprendizado.obter(candidato.id).estado, app.aprendizado.obter(candidato.id).projetosObservados], ["candidato", 1]);

  // Abaixo da mediana: sinal fraco contra. Números absolutos, sozinhos, não dizem nada sobre a edição.
  const abaixo = app.feedback.registrarResultado(projetos[4], { plataforma: "Instagram", metricas: { retencaoPercentual: 20 } });
  assert.deepEqual([abaixo.leitura.sinal, app.aprendizado.evidencias(regra.id).at(-1)?.confirma], ["abaixo", false]);
  const soAlcance = app.feedback.registrarResultado(projetos[5], { plataforma: "Instagram", metricas: { visualizacoes: 2_000_000, cliques: 900 } });
  assert.deepEqual([soAlcance.leitura.sinal, soAlcance.leitura.metrica], ["insuficiente", null]);
  assert.match(soAlcance.leitura.observacao, /não são usados como sinal sobre a edição/);
  assert.equal(app.feedback.registrarResultado(projetos[5], { plataforma: "TikTok", metricas: { visualizacoes: 100, curtidas: 20 } }).leitura.metrica, "engajamento");

  // Reversível: remover o resultado remove o sinal que ele deu.
  const comSinais = app.aprendizado.evidencias(regra.id).length;
  app.feedback.removerResultado(acima.id);
  assert.equal(app.aprendizado.evidencias(regra.id).length, comSinais - 1);
  assert.ok(!app.aprendizado.evidencias(regra.id).some((e) => e.resultadoId === acima.id));
  assert.equal(app.feedback.resultados(projetos[3]).length, 0);
  assert.equal(app.feedback.resultados().length, 6);
});

test("contextos separados no painel e tudo persiste depois de fechar e reabrir", () => {
  app.aprendizado.observar({ escopo: "geral", categoria: "legendas", chave: "uso", valor: "sim", descricao: "Sempre legendar falas", origem: "usuario" });
  const temporaria = app.aprendizado.observar({ escopo: "temporaria", categoria: "ritmo", chave: "especial", valor: "lento", descricao: "Só esta semana", origem: "usuario" });
  const antes = { avaliacoes: 0, resultados: app.feedback.resultados().length, acoes: app.aprendizado.acoes().length, aprendizados: app.aprendizado.listar().length };
  const projetos = app.projetos.listar();
  antes.avaliacoes = projetos.reduce((soma, p) => soma + app.feedback.avaliacoes(p.id).length, 0);
  app.encerrar();

  app = new Aplicacao(caminhos);
  const painel = app.feedback.painel();
  assert.deepEqual(painel.geral.map((x) => x.chave), ["uso"]);
  assert.deepEqual(painel.temporarias.map((x) => x.id), [temporaria.id]);
  for (const perfil of ["fivem", "redm", "publicidade", "youtube"]) assert.ok(painel.perfis[perfil]?.length, `perfil ${perfil} sem aprendizados`);
  assert.ok(Object.values(painel.perfis).flat().every((x) => x.escopo === "especializacao"));
  assert.ok(Object.keys(painel.projetos).length >= 2);
  assert.deepEqual(
    { avaliacoes: app.projetos.listar().reduce((soma, p) => soma + app.feedback.avaliacoes(p.id).length, 0), resultados: app.feedback.resultados().length, acoes: app.aprendizado.acoes().length, aprendizados: app.aprendizado.listar().length },
    antes,
  );
  assert.ok(antes.avaliacoes >= 12 && antes.acoes >= 5);
  assert.equal(app.feedback.perfilAprendido("fivem")["transicoes/tipo-predominante"].valor, "gradual");
});
