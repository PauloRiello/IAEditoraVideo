// Testes do servidor da interface gráfica: sessão, projetos, envio de vídeos, análise em
// segundo plano, plano, timeline, prévia, exportação, avaliação, aprendizado, provedores,
// cópias de segurança e encerramento. Tudo pela API que a interface usa.
// Executar: npm test

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { montarCaminhos } from "../../src/infra/caminhos.ts";
import { Aplicacao } from "../../src/nucleo/aplicacao.ts";
import { iniciarServidor, type ServidorDaInterface } from "../../src/interface/servidor.ts";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const base = mkdtempSync(path.join(os.tmpdir(), "iaev-interface-"));
const caminhos = montarCaminhos(path.join(base, "dados"), path.join(base, "biblioteca"), RAIZ);
caminhos.temporarios = path.join(RAIZ, "Dados", "temp"); // reaproveita o pacote da composição entre execuções
process.env.IAEV_SEM_JANELAS = "1";

let app: Aplicacao;
let servidor: ServidorDaInterface;
let encerrada = false;
let projetoId = "";
const videos: Record<string, Buffer> = {};

interface Resposta { estado: number; dados: any; cabecalhos: Headers; texto: string } // eslint-disable-line @typescript-eslint/no-explicit-any

async function pedir(caminho: string, opcoes: { metodo?: string; corpo?: unknown; arquivo?: Buffer; sessao?: boolean; cabecalhos?: Record<string, string> } = {}): Promise<Resposta> {
  const r = await fetch(`http://127.0.0.1:${servidor.porta}${caminho}`, {
    method: opcoes.metodo ?? (opcoes.corpo !== undefined || opcoes.arquivo ? "POST" : "GET"),
    headers: {
      ...(opcoes.sessao === false ? {} : { "x-iaev-sessao": servidor.token }), ...(opcoes.corpo !== undefined ? { "content-type": "application/json" } : {}),
      ...(opcoes.arquivo ? { "content-type": "application/octet-stream" } : {}), ...opcoes.cabecalhos,
    },
    body: opcoes.arquivo ? new Uint8Array(opcoes.arquivo) : opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
  });
  const texto = await r.text();
  let dados: unknown = null;
  try { dados = JSON.parse(texto); } catch { /* resposta que não é JSON */ }
  return { estado: r.status, dados, cabecalhos: r.headers, texto };
}

/** Pedido com cabeçalhos que o fetch não deixa definir (Host e Origin). */
const cru = (cabecalhos: Record<string, string>): Promise<number> =>
  new Promise((resolver, rejeitar) => {
    http.get({ host: "127.0.0.1", port: servidor.porta, path: "/api/painel", headers: { "x-iaev-sessao": servidor.token, ...cabecalhos } }, (r) => { r.resume(); resolver(r.statusCode ?? 0); }).on("error", rejeitar);
  });

async function esperarExportacao(id: number): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let i = 0; i < 600; i += 1) {
    const e = (await pedir(`/api/projetos/${projetoId}/exportacoes`)).dados.find((x: { id: number }) => x.id === id);
    if (e && !["na-fila", "renderizando"].includes(e.estado)) return e;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("a exportação não terminou");
}

before(async () => {
  const gerar = (nome: string, a: string, b: string) => {
    const arquivo = path.join(base, nome);
    execFileSync("ffmpeg", [
      "-v", "error", "-y", "-f", "lavfi", "-t", "2", "-i", `${a}=s=640x360:r=30`, "-f", "lavfi", "-t", "2", "-i", `${b}=s=640x360:r=30`, "-f", "lavfi", "-t", "4", "-i", "anoisesrc=c=pink:a=0.3:r=48000",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", arquivo,
    ]);
    videos[nome] = readFileSync(arquivo);
  };
  gerar("passeio.mp4", "testsrc2", "smptebars");
  gerar("perseguicao.mp4", "mandelbrot", "rgbtestsrc");
  app = new Aplicacao(caminhos);
  servidor = await iniciarServidor(app, { porta: 0, aoEncerrar: () => { encerrada = true; } });
});

after(async () => {
  if (!encerrada) await servidor?.encerrar();
  rmSync(base, { recursive: true, force: true });
});

test("o servidor só atende ao próprio computador e exige a sessão aberta pelo inicializador", async () => {
  assert.deepEqual((await pedir("/api/saude", { sessao: false })).dados, { ok: true, aplicacao: "ia-editora-video" });
  const semSessao = await pedir("/api/painel", { sessao: false });
  assert.equal(semSessao.estado, 401);
  assert.match(semSessao.dados.erro.mensagem, /atalho|inicializador/);
  assert.equal((await pedir("/", { sessao: false })).estado, 401);
  assert.equal((await pedir("/?t=segredo-errado", { sessao: false })).estado, 401);
  assert.equal((await pedir("/api/painel", { cabecalhos: { "x-iaev-sessao": "0".repeat(48) }, sessao: false })).estado, 401);

  // A página aberta com o segredo recebe um cookie que o JavaScript não lê; daí em diante vale o cookie.
  const pagina = await pedir(new URL(servidor.url).pathname + new URL(servidor.url).search, { sessao: false });
  assert.equal(pagina.estado, 200);
  assert.match(pagina.texto, /<title>IA Editora de Vídeo<\/title>/);
  const cookie = pagina.cabecalhos.get("set-cookie") ?? "";
  assert.match(cookie, /^iaev_sessao=[a-f0-9]+; HttpOnly; SameSite=Strict; Path=\/$/);
  assert.match(pagina.cabecalhos.get("content-security-policy") ?? "", /default-src 'self'/);
  assert.equal((await pedir("/api/painel", { sessao: false, cabecalhos: { cookie: cookie.split(";")[0] } })).estado, 200);

  // Outros sites não conseguem usar a aplicação, nem com o segredo.
  assert.equal(await cru({ host: "site-malicioso.example" }), 403);
  assert.equal(await cru({ origin: "http://site-malicioso.example" }), 403);
  assert.equal(await cru({}), 200);

  // Arquivos da interface: só os da pasta dela.
  const script = await pedir("/telas/painel.js");
  assert.equal(script.estado, 200);
  assert.match(script.cabecalhos.get("content-type") ?? "", /javascript/);
  for (const caminho of ["/..%2f..%2fpackage.json", "/%2e%2e/%2e%2e/package.json", "/nao-existe.js"]) assert.equal((await pedir(caminho)).estado, 404, caminho);
  assert.equal((await pedir("/api/nao-existe")).estado, 404);

  const catalogo = (await pedir("/api/catalogo")).dados;
  for (const perfil of ["geral", "fivem", "redm", "publicidade", "institucional", "youtube", "documentario", "educacao"]) assert.ok(catalogo.perfis.some((p: { id: string }) => p.id === perfil), perfil);
  assert.ok(catalogo.estilos.length >= 10 && catalogo.presets.length >= 7 && catalogo.destinos.length >= 6);
});

test("projetos: criação com configuração completa, alteração e validação", async () => {
  const criado = await pedir("/api/projetos", {
    corpo: {
      nome: "Cidade: Alta?", perfil: "fivem",
      configuracao: { objetivo: "Divulgar a inauguração", publico: "Jogadores de roleplay", plataforma: "Instagram Reels", largura: 360, altura: 640, fps: 30, duracaoSeg: 4, estilos: ["trailer"], cta: "Entre no Discord", fatos: ["Abre no dia 20"], intervencao: "assistido" },
    },
  });
  assert.equal(criado.estado, 200, criado.texto);
  projetoId = criado.dados.id;
  assert.deepEqual([criado.dados.perfil, criado.dados.formatoEfetivo.largura, criado.dados.formatoEfetivo.altura, criado.dados.formatoEfetivo.fps, criado.dados.resumo.etapa], ["fivem", 360, 640, 30, "material"]);
  assert.equal(criado.dados.configuracao.pasta, "Cidade Alta", "o nome da pasta é aceito pelo Windows");
  assert.ok(existsSync(path.join(caminhos.brutos, "Cidade Alta")), "a pasta de material do projeto é criada");

  for (const [configuracao, trecho] of [[{ largura: 361, altura: 640 }, /pares/], [{ largura: 360, altura: null }, /largura e a altura/], [{ fps: 500 }, /taxa de quadros/], [{ intervencao: "total" }, /intervenção/]] as const) {
    const r = await pedir(`/api/projetos/${projetoId}`, { metodo: "PUT", corpo: { configuracao } });
    assert.equal(r.estado, 422);
    assert.match(r.dados.erro.mensagem, trecho);
  }
  assert.equal((await pedir("/api/projetos", { corpo: { nome: "  ", perfil: "fivem" } })).estado, 422);
  assert.equal((await pedir("/api/projetos", { corpo: { nome: "X", perfil: "nao-existe" } })).estado, 404);
  assert.equal((await pedir("/api/projetos/nao-existe")).estado, 404);

  const alterado = await pedir(`/api/projetos/${projetoId}`, { metodo: "PUT", corpo: { nome: "Cidade Alta", configuracao: { publico: "Jogadores de FiveM" } } });
  assert.deepEqual([alterado.dados.nome, alterado.dados.configuracao.publico, alterado.dados.configuracao.objetivo, alterado.dados.configuracao.pasta], ["Cidade Alta", "Jogadores de FiveM", "Divulgar a inauguração", "Cidade Alta"]);
  assert.equal((await pedir("/api/projetos")).dados.length, 1);
  const atividades = (await pedir(`/api/projetos/${projetoId}/atividades`)).dados;
  assert.match(atividades.at(-1).descricao, /criado/);
});

test("envio de vídeos: grava na pasta do projeto, sem sobrescrever e só tipos aceitos", async () => {
  const enviar = (nome: string, arquivo: Buffer) => pedir(`/api/projetos/${projetoId}/brutos/arquivo?nome=${encodeURIComponent(nome)}`, { arquivo });
  assert.equal((await enviar("passeio.mp4", videos["passeio.mp4"])).dados.arquivo, "passeio.mp4");
  assert.equal((await enviar("perseguicao.mp4", videos["perseguicao.mp4"])).dados.arquivo, "perseguicao.mp4");
  assert.equal((await enviar("../../passeio.mp4", videos["passeio.mp4"])).dados.arquivo, "passeio (2).mp4", "nome repetido não sobrescreve; o caminho enviado é ignorado");
  assert.equal((await enviar("programa.exe", Buffer.from("x"))).estado, 415);
  assert.equal((await enviar("vazio.mp4", Buffer.alloc(0))).estado, 400);
  const pasta = path.join(caminhos.brutos, "Cidade Alta");
  assert.deepEqual(readdirSync(pasta).sort(), ["passeio (2).mp4", "passeio.mp4", "perseguicao.mp4"]);
  assert.ok(readFileSync(path.join(pasta, "passeio.mp4")).equals(videos["passeio.mp4"]), "o arquivo gravado é idêntico ao enviado");

  const brutos = (await pedir(`/api/projetos/${projetoId}/brutos`)).dados;
  assert.deepEqual(brutos.map((b: { nome: string; analisado: boolean }) => [b.nome, b.analisado]), [["passeio.mp4", false], ["perseguicao.mp4", false], ["passeio (2).mp4", false]]);
  assert.equal((await pedir(`/api/projetos/${projetoId}`)).dados.resumo.etapa, "analise");
});

test("análise em segundo plano, com eventos ao vivo; no nível assistido o plano é gerado ao terminar", async () => {
  // A janela acompanha o processamento por eventos enviados pelo servidor.
  const escuta = new AbortController();
  const fluxo = await fetch(`http://127.0.0.1:${servidor.porta}/api/eventos`, { headers: { "x-iaev-sessao": servidor.token }, signal: escuta.signal });
  assert.match(fluxo.headers.get("content-type") ?? "", /text\/event-stream/);
  let recebido = "";
  const leitura = (async () => {
    const leitor = fluxo.body!.getReader();
    try {
      for (;;) { const { done, value } = await leitor.read(); if (done) break; recebido += Buffer.from(value).toString("utf8"); }
    } catch { /* escuta encerrada pelo teste */ }
  })();

  const tarefa = await pedir(`/api/projetos/${projetoId}/brutos/analisar`, { corpo: { transcrever: false } });
  assert.deepEqual([tarefa.dados.tipo, tarefa.dados.projetoId, ["na-fila", "executando"].includes(tarefa.dados.estado)], ["analise-de-brutos", projetoId, true]);
  assert.equal((await pedir(`/api/projetos/${projetoId}`, { metodo: "DELETE" })).estado, 422, "não se remove um projeto durante o processamento");
  await app.tarefas.aguardar();
  await new Promise((r) => setTimeout(r, 200));
  escuta.abort();
  await leitura;
  assert.match(recebido, /event: tarefa:atualizada\ndata: \{[^\n]*"estado":"executando"/);
  assert.match(recebido, /event: tarefa:atualizada\ndata: \{[^\n]*"estado":"concluida"/);
  assert.match(recebido, /event: atividade\ndata: /);
  // Toda tarefa em andamento informa a porcentagem, e ela avança durante a análise, não só ao fim de cada vídeo.
  const andamento = [...recebido.matchAll(/event: tarefa:atualizada\ndata: (.*)\n/g)].map((m) => JSON.parse(m[1]) as { id: string; estado: string; progresso: number | null; etapa: string }).filter((t) => t.id === tarefa.dados.id);
  assert.ok(andamento.every((t) => typeof t.progresso === "number" && t.progresso >= 0 && t.progresso <= 1), "nenhum aviso sem porcentagem");
  const fracoes = andamento.filter((t) => t.estado === "executando").map((t) => t.progresso as number);
  assert.ok(fracoes.every((f, i) => i === 0 || f >= fracoes[i - 1]), "a porcentagem só avança");
  assert.ok(new Set(fracoes.map((f) => Math.floor(f * 100))).size >= 8, `a porcentagem avança em vários passos: ${fracoes.map((f) => Math.floor(f * 100)).join(", ")}`);
  assert.ok(andamento.some((t) => /\(1 de 3\): medindo o som/.test(t.etapa)), "a etapa diz o que está sendo feito em cada vídeo");

  const concluida = (await pedir("/api/tarefas")).dados.find((t: { id: string }) => t.id === tarefa.dados.id);
  assert.deepEqual([concluida.estado, concluida.erro, concluida.progresso], ["concluida", null, 1]);
  const brutos = (await pedir(`/api/projetos/${projetoId}/brutos`)).dados;
  assert.ok(brutos.every((b: { analisado: boolean; integridade: string; cenas: number; tecnico: { largura: number } }) => b.analisado && b.integridade === "integro" && b.cenas >= 1 && b.tecnico.largura === 640));
  const detalhe = (await pedir(`/api/projetos/${projetoId}/brutos/${brutos[1].id}`)).dados;
  assert.ok(detalhe.conteudo.cenas.length >= 2 && detalhe.arquivo.tecnico.duracaoSeg > 3);
  const miniatura = await pedir(detalhe.conteudo.cenas.find((c: { miniatura: string | null }) => c.miniatura).miniatura);
  assert.deepEqual([miniatura.estado, miniatura.cabecalhos.get("content-type")], [200, "image/jpeg"]);
  assert.equal((await pedir(`/api/projetos/${projetoId}/brutos/${brutos[1].id}/miniaturas/999`)).estado, 404);
  assert.ok((await pedir(`/api/projetos/${projetoId}/pesquisa?q=cena`)).dados.length > 0);

  const plano = (await pedir(`/api/projetos/${projetoId}/plano`)).dados;
  assert.deepEqual([plano.atual.versao, plano.atual.estado, plano.atual.plano.objetivo, plano.atual.plano.cta.texto], [1, "rascunho", "Divulgar a inauguração", "Entre no Discord"]);
  assert.deepEqual([plano.atual.plano.formato.largura, plano.atual.plano.formato.altura], [360, 640]);
  const painel = (await pedir("/api/painel")).dados;
  assert.equal(painel.projetos[0].resumo.etapa, "aprovacao");
  assert.ok(painel.atividades.some((a: { descricao: string; projetoNome: string }) => /Plano v1 gerado/.test(a.descricao) && a.projetoNome === "Cidade Alta"));
});

test("a edição espera a aprovação; aprovado o plano, a timeline é montada e alterada por operações", async () => {
  const cedo = await pedir(`/api/projetos/${projetoId}/timeline/montar`, { corpo: {} });
  assert.deepEqual([cedo.estado, cedo.dados.erro.codigo], [422, "plano-nao-aprovado"]);
  assert.equal((await pedir(`/api/projetos/${projetoId}/previa`, { corpo: {} })).estado, 422, "sem plano aprovado não há prévia");

  const aprovado = (await pedir(`/api/projetos/${projetoId}/plano/aprovar`, { corpo: {} })).dados;
  assert.deepEqual([aprovado.atual.estado, aprovado.timelineMontada, aprovado.previaIniciada], ["aprovado", 1, null]);
  const roteiro = (await pedir(`/api/projetos/${projetoId}/roteiro`, { corpo: {} })).dados.roteiro;
  assert.ok(roteiro.linhas.length > 0 && roteiro.base === "estrutura", "sem provedor de IA, o roteiro é a estrutura com os fatos");

  let t = (await pedir(`/api/projetos/${projetoId}/timeline`)).dados;
  assert.deepEqual([t.atual.versao, t.atual.timeline.formato.largura, t.atual.timeline.formato.altura, t.planoAprovado], [1, 360, 640, true]);
  assert.ok(t.montagem.decisoes.length > 0);
  const texto = { id: "aviso", tipo: "texto", camada: 20, inicioSeg: 0, duracaoSeg: 2, texto: "Abre no dia 20", posicao: "topo", tamanho: 0.05, cor: "#ffffff", fundo: "rgba(0,0,0,0.6)", animacao: "surgir" };
  t = (await pedir(`/api/projetos/${projetoId}/timeline/operacoes`, { corpo: { operacoes: [{ tipo: "inserir", item: texto }], nota: "Texto de abertura" } })).dados;
  assert.deepEqual([t.atual.versao, t.atual.autor, t.atual.nota], [2, "usuario", "Texto de abertura"]);
  const invalida = await pedir(`/api/projetos/${projetoId}/timeline/operacoes`, { corpo: { operacoes: [{ tipo: "remover", id: "nao-existe" }] } });
  assert.equal(invalida.estado, 404);
  assert.equal((await pedir(`/api/projetos/${projetoId}/timeline/operacoes`, { corpo: {} })).estado, 400);
  const comparacao = (await pedir(`/api/projetos/${projetoId}/timeline/comparacao?de=1&para=2`)).dados;
  assert.deepEqual(comparacao.itens.adicionados, [{ id: "aviso", tipo: "texto" }]);
  t = (await pedir(`/api/projetos/${projetoId}/timeline/restaurar`, { corpo: { versao: 1 } })).dados;
  assert.equal(t.atual.versao, 3);
  t = (await pedir(`/api/projetos/${projetoId}/timeline/restaurar`, { corpo: { versao: 2 } })).dados;
  assert.deepEqual([t.atual.versao, t.historico.length, t.atual.timeline.itens.some((i: { id: string }) => i.id === "aviso")], [4, 4, true]);

  const qualidade = (await pedir(`/api/projetos/${projetoId}/qualidade`, { corpo: {} })).dados;
  assert.deepEqual([qualidade.perfilDeQualidade, qualidade.exportacaoId, qualidade.situacao === "reprovado"], ["redes-sociais", null, false]);
});

test("prévia e exportação final: progresso, reprodução com avanço, relatório de qualidade e histórico", async () => {
  const previa = await esperarExportacao((await pedir(`/api/projetos/${projetoId}/previa`, { corpo: {} })).dados.id);
  assert.deepEqual([previa.estado, previa.tipo, previa.arquivoExiste], ["concluida", "previa", true], previa.erro ?? "");
  const inteiro = await fetch(`http://127.0.0.1:${servidor.porta}/api/projetos/${projetoId}/exportacoes/${previa.id}/arquivo`, { headers: { "x-iaev-sessao": servidor.token } });
  assert.deepEqual([inteiro.status, inteiro.headers.get("content-type"), inteiro.headers.get("accept-ranges"), Number(inteiro.headers.get("content-length"))], [200, "video/mp4", "bytes", previa.tamanhoBytes]);
  await inteiro.arrayBuffer();
  const parte = await pedir(`/api/projetos/${projetoId}/exportacoes/${previa.id}/arquivo`, { cabecalhos: { range: "bytes=100-299" } });
  assert.deepEqual([parte.estado, parte.cabecalhos.get("content-range"), parte.cabecalhos.get("content-length")], [206, `bytes 100-299/${previa.tamanhoBytes}`, "200"]);
  const fim = await pedir(`/api/projetos/${projetoId}/exportacoes/${previa.id}/arquivo`, { cabecalhos: { range: "bytes=-50" } });
  assert.deepEqual([fim.estado, fim.cabecalhos.get("content-length")], [206, "50"]);
  assert.equal((await pedir(`/api/projetos/${projetoId}/exportacoes/${previa.id}/arquivo`, { cabecalhos: { range: `bytes=${previa.tamanhoBytes + 10}-` } })).estado, 416);
  assert.equal((await pedir(`/api/projetos/${projetoId}/exportacoes/999/arquivo`)).estado, 404);

  assert.equal((await pedir(`/api/projetos/${projetoId}/exportar`, { corpo: { preset: "horizontal-1080" } })).estado, 422, "preset de outra proporção é recusado");
  const final = await esperarExportacao((await pedir(`/api/projetos/${projetoId}/exportar`, { corpo: { preset: "padrao" } })).dados.id);
  assert.deepEqual([final.estado, final.largura, final.altura, final.preset], ["concluida", 360, 640, "padrao"], final.erro ?? "");
  assert.ok(final.arquivo.startsWith(path.join(caminhos.exportacoes, "Cidade Alta")) && existsSync(final.arquivo));
  assert.ok(final.relatorio && final.relatorio.situacao !== "reprovado");

  const relatorio = (await pedir(`/api/projetos/${projetoId}/exportacoes/${final.id}/relatorio`)).dados;
  assert.match(relatorio.markdown, /# Relatório de qualidade: Cidade Alta/);
  const obrigatoria = relatorio.relatorio.verificacoes.find((v: { gravidade: string }) => v.gravidade === "obrigatoria");
  const recusa = await pedir(`/api/projetos/${projetoId}/relatorios/${relatorio.relatorio.id}/excecoes`, { corpo: { verificacaoId: obrigatoria.id, justificativa: "Deixa passar" } });
  assert.equal(recusa.estado, 422);
  for (const pendencia of relatorio.relatorio.verificacoes.filter((v: { situacao: string; gravidade: string }) => v.situacao === "reprovada" && v.gravidade === "importante")) {
    const aceita = await pedir(`/api/projetos/${projetoId}/relatorios/${relatorio.relatorio.id}/excecoes`, { corpo: { verificacaoId: pendencia.id, justificativa: "Conferido no vídeo" } });
    assert.equal(aceita.estado, 200);
  }
  assert.ok(["aprovado", "aprovado-com-ressalvas"].includes((await pedir(`/api/projetos/${projetoId}/exportacoes`)).dados.find((e: { id: number }) => e.id === final.id).relatorio.situacao));
  const resumo = (await pedir(`/api/projetos/${projetoId}`)).dados.resumo;
  assert.deepEqual([resumo.etapa, resumo.previas, resumo.exportacoes], ["concluido", 1, 1]);
  const tarefas = (await pedir("/api/tarefas")).dados;
  assert.ok(tarefas.some((x: { id: string; tipo: string; estado: string }) => x.id === `render-${final.id}` && x.tipo === "exportacao" && x.estado === "concluida"), "os renders aparecem no status do processamento");
});

test("avaliação, preferências e controle do que foi aprendido", async () => {
  const semMotivo = await pedir(`/api/projetos/${projetoId}/avaliacoes`, { corpo: { decisao: "rejeitada" } });
  assert.equal(semMotivo.estado, 422);
  const avaliacao = await pedir(`/api/projetos/${projetoId}/avaliacoes`, { corpo: { decisao: "aprovada", motivo: "Bom ritmo", notas: { ritmo: 5, efeitos: 2 }, trechos: [{ inicioSeg: 1, fimSeg: 2, comentario: "Corte brusco" }] } });
  assert.equal(avaliacao.estado, 200, avaliacao.texto);
  let lista = (await pedir(`/api/projetos/${projetoId}/avaliacoes`)).dados;
  assert.deepEqual([lista.avaliacoes.length, lista.avaliacoes[0].notas.ritmo, lista.trechos.length, lista.trechos[0].resolvido], [1, 5, 1, false]);
  await pedir(`/api/trechos/${lista.trechos[0].id}/resolver`, { corpo: {} });
  const resultado = await pedir(`/api/projetos/${projetoId}/resultados`, { corpo: { plataforma: "Instagram", metricas: { visualizacoes: 1200, retencaoPercentual: 48 } } });
  assert.deepEqual([resultado.estado, resultado.dados.leitura.sinal], [200, "insuficiente"]);
  lista = (await pedir(`/api/projetos/${projetoId}/avaliacoes`)).dados;
  assert.deepEqual([lista.trechos[0].resolvido, lista.resultados.length], [true, 1]);

  // Preferência dita pelo usuário: vale de imediato; pode ser desativada e a ação desfeita.
  const preferencia = (await pedir("/api/aprendizado/preferencias", { corpo: { escopo: "especializacao", perfil: "fivem", categoria: "efeitos-visuais", descricao: "Nunca usar barras de cinema em vídeos verticais" } })).dados;
  assert.deepEqual([preferencia.estado, preferencia.escopo, preferencia.perfil, preferencia.categoria], ["ativo", "especializacao", "fivem", "efeitos-visuais"]);
  assert.equal((await pedir("/api/aprendizado/preferencias", { corpo: { descricao: " " } })).estado, 400);
  let aprendizado = (await pedir("/api/aprendizado")).dados;
  assert.ok(aprendizado.painel.perfis.fivem.some((a: { id: number }) => a.id === preferencia.id));
  assert.equal(aprendizado.projetos[projetoId], "Cidade Alta");
  const detalhe = (await pedir(`/api/aprendizados/${preferencia.id}`)).dados;
  assert.deepEqual([detalhe.evidencias.length, detalhe.evidencias[0].origem], [1, "usuario"]);
  assert.equal((await pedir(`/api/aprendizados/${preferencia.id}/desativar`, { corpo: {} })).dados.estado, "desativado");
  aprendizado = (await pedir("/api/aprendizado")).dados;
  assert.deepEqual([aprendizado.acoes[0].acao, aprendizado.acoes[0].desfeita], ["desativado", false]);
  assert.equal((await pedir(`/api/aprendizado/acoes/${aprendizado.acoes[0].id}/desfazer`, { corpo: {} })).dados.estado, "ativo");
  assert.equal((await pedir("/api/aprendizados/abc")).estado, 400);
});

test("provedores de IA são opcionais; a chave fica no cofre e nunca volta para a interface", async () => {
  const CHAVE = "sk-chave-secreta-de-teste-0123456789";
  let c = (await pedir("/api/configuracoes")).dados;
  assert.deepEqual([c.provedores, c.ia.permitirExternos, c.recursos.filter((r: { local: boolean }) => r.local).length >= 8], [[], false, true]);
  assert.deepEqual((await pedir("/api/ia/locais")).dados.filter((s: { id: string }) => s.id === "nao-existe"), []);

  for (const invalido of [{ id: "x", nome: "X", urlBase: "ftp://x", modelo: "m" }, { id: "X Y", nome: "X", urlBase: "https://x.invalid/v1", modelo: "m" }, { id: "x", nome: "X", urlBase: "https://x.invalid/v1", modelo: "" }]) {
    assert.equal((await pedir("/api/ia/provedores", { corpo: invalido })).estado, 422);
  }
  const salvo = await pedir("/api/ia/provedores", { corpo: { id: "servico", nome: "Serviço externo", origem: "externo", urlBase: "https://servico.invalid/v1", modelo: "modelo-x", capacidades: ["texto"], chave: CHAVE } });
  assert.equal(salvo.estado, 200, salvo.texto);
  c = salvo.dados;
  assert.deepEqual([c.provedores[0].id, c.provedores[0].temChave, c.provedores[0].exigeChave, c.provedores[0].estado.permitido, c.provedores[0].estado.disponivel], ["servico", true, true, false, false]);

  // A chave não aparece em nenhuma resposta nem no arquivo de configurações: só no cofre, na pasta de dados.
  for (const caminho of ["/api/configuracoes", "/api/painel", "/api/catalogo", "/api/backups"]) assert.ok(!(await pedir(caminho)).texto.includes(CHAVE), caminho);
  assert.ok(!salvo.texto.includes(CHAVE));
  assert.ok(!readFileSync(caminhos.configuracoes, "utf8").includes(CHAVE));
  const cofre = path.join(path.dirname(caminhos.configuracoes), "credenciais.json");
  assert.deepEqual(JSON.parse(readFileSync(cofre, "utf8")), { servico: CHAVE });
  const copia = (await pedir("/api/backups", { corpo: {} })).dados[0];
  assert.ok(!readdirSync(copia.pasta).some((nome) => readFileSync(path.join(copia.pasta, nome)).includes(CHAVE)), "a chave não entra na cópia de segurança");

  // Alterar sem informar a chave mantém a guardada; externos só valem com autorização explícita.
  c = (await pedir("/api/ia/provedores", { corpo: { id: "servico", nome: "Serviço", origem: "externo", urlBase: "https://servico.invalid/v1", modelo: "modelo-y", capacidades: ["texto"] } })).dados;
  assert.deepEqual([c.provedores.length, c.provedores[0].modelo, c.provedores[0].temChave], [1, "modelo-y", true]);
  c = (await pedir("/api/ia/politica", { metodo: "PUT", corpo: { permitirExternos: true } })).dados;
  assert.deepEqual([c.ia.permitirExternos, c.provedores[0].estado.permitido], [true, true]);
  c = (await pedir("/api/ia/provedores/servico", { metodo: "DELETE" })).dados;
  assert.deepEqual([c.provedores, JSON.parse(readFileSync(cofre, "utf8"))], [[], {}]);

  // Preferências gerais.
  c = (await pedir("/api/configuracoes", { metodo: "PUT", corpo: { perfilPadrao: "fivem", transcricao: { modelo: "tiny", idioma: "PT" }, backup: { manter: 5 } } })).dados;
  assert.deepEqual([c.perfilPadrao, c.transcricao, c.backup.manter], ["fivem", { modelo: "tiny", idioma: "pt" }, 5]);
  assert.equal((await pedir("/api/configuracoes", { metodo: "PUT", corpo: { transcricao: { modelo: "gigante" } } })).estado, 400);
  assert.equal((await pedir("/api/abrir", { corpo: { alvo: "brutos", projetoId } })).dados.pasta, path.join(caminhos.brutos, "Cidade Alta"));
  assert.equal((await pedir("/api/abrir", { corpo: { alvo: "/etc" } })).estado, 400);
});

test("cópia de segurança, restauração e encerramento pela interface", async () => {
  const antes = (await pedir("/api/backups", { corpo: {} })).dados;
  assert.equal(antes[0].motivo, "manual");
  await pedir("/api/projetos", { corpo: { nome: "Projeto depois da cópia", perfil: "geral" } });
  assert.equal((await pedir("/api/projetos")).dados.length, 2);
  const restaurada = await pedir("/api/backups/restaurar", { corpo: { nome: antes[0].nome } });
  assert.equal(restaurada.estado, 200, restaurada.texto);
  assert.equal(restaurada.dados.anterior.motivo, "pre-restauracao");
  const projetos = (await pedir("/api/projetos")).dados;
  assert.deepEqual(projetos.map((p: { nome: string }) => p.nome), ["Cidade Alta"]);
  assert.equal(projetos[0].resumo.exportacoes, 1, "o histórico do projeto volta junto");
  assert.equal((await pedir("/api/backups/restaurar", { corpo: { nome: "nao-existe" } })).estado, 404);

  assert.deepEqual((await pedir("/api/encerrar", { corpo: {} })).dados, { encerrando: true });
  for (let i = 0; i < 50 && !encerrada; i += 1) await new Promise((r) => setTimeout(r, 100));
  assert.ok(encerrada, "a aplicação avisa que encerrou");
  await assert.rejects(pedir("/api/saude", { sessao: false }), "o servidor parou de atender");
  assert.throws(() => app.projetos.listar(), "o banco foi fechado");

  // Tudo continua lá ao abrir de novo.
  const reaberta = new Aplicacao(caminhos);
  assert.deepEqual(reaberta.projetos.listar().map((p) => [p.nome, p.configuracao.objetivo]), [["Cidade Alta", "Divulgar a inauguração"]]);
  assert.ok(reaberta.atividades.listar({ projetoId }).length > 5 && reaberta.edicao.exportacoes(projetoId).length === 2);
  reaberta.encerrar();
});
