// Testes do motor de edição: timeline editável, estilos, montagem a partir do plano
// aprovado, prévia, exportação final, cancelamento, falha e formatos.
// Os vídeos de teste são gerados pelo FFmpeg e renderizados de verdade. Executar: npm test

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";
import { sondar } from "../../Pipeline/analysis/ferramentas.ts";
import { medirVisual } from "../../Pipeline/analysis/visual.ts";
import type { ItemVideo, Timeline } from "../../src/dominio/timeline.ts";
import { montarCaminhos } from "../../src/infra/caminhos.ts";
import { Aplicacao } from "../../src/nucleo/aplicacao.ts";
import { aplicarOperacao, faixaPrincipal } from "../../src/servicos/timeline.ts";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const base = mkdtempSync(path.join(os.tmpdir(), "iaev-edicao-"));
const caminhos = montarCaminhos(path.join(base, "dados"), path.join(base, "biblioteca"), RAIZ);
caminhos.modelos = path.join(RAIZ, "Dados", "modelos"); // reaproveita o modelo do Whisper
caminhos.temporarios = path.join(RAIZ, "Dados", "temp"); // reaproveita o pacote da composição entre execuções
const bruto = (nome: string) => path.join(caminhos.brutos, nome);
const musica = path.join(base, "trilha.m4a");
const imagem = path.join(base, "logo.png");
const resumo = (arquivo: string) => createHash("sha1").update(readFileSync(arquivo)).digest("hex");
let app: Aplicacao;
let projetoId = "";
let originais: Record<string, string> = {};

before(async () => {
  mkdirSync(caminhos.brutos, { recursive: true });
  const rodar = (argumentos: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...argumentos], { stdio: "pipe" });
  const h264 = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"];
  // 1080p horizontal, 30 quadros/s: 4 s parados, 4 s de ação com som, 2 s de tela preta.
  rodar([
    "-f", "lavfi", "-t", "4", "-i", "smptebars=s=1920x1080:r=30", "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=1:d=1",
    "-f", "lavfi", "-t", "2", "-i", "color=c=black:s=1920x1080:r=30", "-f", "lavfi", "-t", "4", "-i", "sine=f=220:r=44100",
    "-f", "lavfi", "-t", "4", "-i", "anoisesrc=c=pink:a=0.8:r=44100", "-f", "lavfi", "-t", "2", "-i", "anullsrc=r=44100:cl=mono",
    "-filter_complex",
    "[1:v]zoompan=z=1.5:x='320+300*sin(on/6)':y=40:d=120:s=1920x1080:fps=30,trim=end_frame=120,setpts=PTS-STARTPTS[acao];[0:v][acao][2:v]concat=n=3:v=1:a=0[v];" +
      "[3:a]volume=0.05[calmo];[calmo][4:a][5:a]concat=n=3:v=0:a=1[a]",
    "-map", "[v]", "-map", "[a]", ...h264, "-c:a", "aac", "-ac", "2", bruto("01-acao.mp4"),
  ]);
  // 720×1280 vertical, MOV, 60 quadros/s, com fala (ou um tom, se o FFmpeg não tiver voz sintética).
  const video = ["-f", "lavfi", "-i", "color=c=0x203040:s=720x1280:r=60", ...h264, "-c:a", "aac", "-shortest", bruto("02-fala.mov")];
  try {
    rodar(["-f", "lavfi", "-i", "flite=text='Welcome to the city. This is the best role play server. Join our discord today.':voice=slt", ...video]);
  } catch {
    rodar(["-f", "lavfi", "-t", "5", "-i", "sine=f=330:r=44100", ...video]);
  }
  rodar(["-f", "lavfi", "-t", "20", "-i", "sine=f=110:r=44100", "-c:a", "aac", musica]);
  rodar(["-f", "lavfi", "-i", "color=c=0xcc3322:s=400x400", "-frames:v", "1", imagem]);
  originais = Object.fromEntries(["01-acao.mp4", "02-fala.mov"].map((nome) => [nome, resumo(bruto(nome))]));

  app = new Aplicacao(caminhos);
  app.configuracoes.transcricao = { modelo: "tiny", idioma: "en" };
  projetoId = app.criarProjeto("Cidade Alta", "fivem").id;
  app.producao.importarBrutos(projetoId);
  await app.producao.analisarBrutos(projetoId);
  app.producao.planejar(projetoId, {
    objetivo: "Divulgar a inauguração", duracaoDesejadaSeg: 6, cta: "Entre no nosso Discord", fatos: ["Inauguração no dia 20"], estilos: ["trailer"],
  });
  await app.producao.escreverRoteiro(projetoId);
});

after(async () => {
  await app?.edicao.cancelarTudo();
  app?.encerrar();
  rmSync(base, { recursive: true, force: true });
});

const visual = { enquadramento: { modo: "preencher" as const, x: 0.5, y: 0.5, zoom: 1 }, entrada: { tipo: "corte" as const, duracaoSeg: 0 }, saida: { tipo: "corte" as const, duracaoSeg: 0 }, efeitos: [] };
const clipe = (id: string, duracaoSeg: number, extra: Partial<ItemVideo> = {}): ItemVideo => ({
  id, tipo: "video", camada: 0, inicioSeg: 0, duracaoSeg, arquivo: "/videos/a.mp4", inicioOrigemSeg: 10, velocidade: 1, volume: 1, ...visual, ...extra,
});
const VAZIA: Timeline = { versao: 1, formato: { largura: 1080, altura: 1920, fps: 30 }, duracaoSeg: 0, itens: [], efeitosGlobais: [], legendas: { tamanho: 0.03, caixa: true } };

test("timeline: organizar, cortar, dividir, reposicionar, camadas, textos, áudio, velocidade e enquadramento", () => {
  let t = [clipe("a", 4), clipe("b", 3), clipe("c", 2)].reduce((tl, item) => aplicarOperacao(tl, { tipo: "inserir", item: { ...item, inicioSeg: 99 + tl.itens.length } }), VAZIA);
  const posicoes = (tl: Timeline) => faixaPrincipal(tl).map((i) => [i.id, i.inicioSeg, i.duracaoSeg]);
  assert.deepEqual(posicoes(t), [["a", 0, 4], ["b", 4, 3], ["c", 7, 2]], "os clipes encostam uns nos outros");
  assert.equal(t.duracaoSeg, 9);

  // Legenda presa ao clipe "b" e texto livre em outra camada.
  t = aplicarOperacao(t, { tipo: "inserir", item: { id: "leg", tipo: "legenda", camada: 10, inicioSeg: 0, duracaoSeg: 2, texto: "Olá", ancora: { itemId: "b", deslocamentoSeg: 0.5 } } });
  t = aplicarOperacao(t, { tipo: "inserir", item: { id: "txt", tipo: "texto", camada: 20, inicioSeg: 1, duracaoSeg: 2, texto: "Título", posicao: "topo", tamanho: 0.05, cor: "#fff", fundo: "", animacao: "surgir" } });
  assert.equal(t.itens.find((i) => i.id === "leg")?.inicioSeg, 4.5);

  // Cortar o início e o fim de "a": o ponto de origem avança e tudo depois se aproxima.
  const cortada = aplicarOperacao(t, { tipo: "cortar", id: "a", inicioSeg: 1, fimSeg: 3 });
  assert.deepEqual([cortada.itens.find((i) => i.id === "a")?.duracaoSeg, (cortada.itens.find((i) => i.id === "a") as ItemVideo).inicioOrigemSeg], [2, 11]);
  assert.deepEqual(posicoes(cortada), [["a", 0, 2], ["b", 2, 3], ["c", 5, 2]]);
  assert.equal(cortada.itens.find((i) => i.id === "leg")?.inicioSeg, 2.5, "a legenda acompanha o clipe a que está presa");
  assert.deepEqual(posicoes(t), [["a", 0, 4], ["b", 4, 3], ["c", 7, 2]], "a timeline original não foi alterada");

  // Reposicionar: "c" vai para o começo.
  const reordenada = aplicarOperacao(cortada, { tipo: "reposicionar", id: "c", posicao: 0 });
  assert.deepEqual(posicoes(reordenada), [["c", 0, 2], ["a", 2, 2], ["b", 4, 3]]);
  assert.equal(reordenada.itens.find((i) => i.id === "leg")?.inicioSeg, 4.5);

  // Dividir "b" em 1 s: a legenda (em 0,5 s) fica na primeira metade; a segunda continua do ponto certo do original.
  const dividida = aplicarOperacao(reordenada, { tipo: "dividir", id: "b", emSeg: 1 });
  assert.deepEqual(posicoes(dividida), [["c", 0, 2], ["a", 2, 2], ["b", 4, 1], ["b-b", 5, 2]]);
  assert.equal((dividida.itens.find((i) => i.id === "b-b") as ItemVideo).inicioOrigemSeg, 11);
  assert.equal(dividida.itens.find((i) => i.id === "leg")?.duracaoSeg, 0.5, "a legenda é encurtada para caber no trecho");

  // Transição gradual sobrepõe os clipes; velocidade, volume e enquadramento são campos editáveis.
  let editada = aplicarOperacao(dividida, { tipo: "alterar", id: "a", campos: { entrada: { tipo: "gradual", duracaoSeg: 0.5 }, velocidade: 2, volume: 0.4, enquadramento: { x: 0.2, zoom: 1.3 } } });
  const a = editada.itens.find((i) => i.id === "a") as ItemVideo;
  assert.deepEqual([a.inicioSeg, a.velocidade, a.volume, a.enquadramento], [1.5, 2, 0.4, { modo: "preencher", x: 0.2, y: 0.5, zoom: 1.3 }]);
  assert.equal(editada.duracaoSeg, 6.5);
  editada = aplicarOperacao(editada, { tipo: "ajustar-duracao", id: "c", duracaoSeg: 1 });
  editada = aplicarOperacao(editada, { tipo: "mover", id: "txt", inicioSeg: 3 });
  editada = aplicarOperacao(editada, { tipo: "mudar-camada", id: "txt", camada: 30 });
  editada = aplicarOperacao(editada, { tipo: "efeito-global", efeito: { tipo: "barras-de-cinema", proporcao: 2.39 } });
  editada = aplicarOperacao(editada, { tipo: "formato", formato: { largura: 1920, altura: 1080, fps: 24 } });
  editada = aplicarOperacao(editada, {
    tipo: "inserir",
    item: { id: "som", tipo: "audio", papel: "efeito-sonoro", camada: 0, inicioSeg: 2, duracaoSeg: 1, arquivo: "/sons/whoosh.wav", inicioOrigemSeg: 0, volume: 0.8, fadeDeEntradaSeg: 0, fadeDeSaidaSeg: 0.2, reduzirEm: [], volumeReduzido: 0 },
  });
  assert.deepEqual([editada.itens.find((i) => i.id === "txt")?.inicioSeg, editada.itens.find((i) => i.id === "txt")?.camada, editada.duracaoSeg], [3, 30, 5.5]);
  assert.deepEqual([editada.formato, editada.efeitosGlobais.length], [{ largura: 1920, altura: 1080, fps: 24 }, 1]);

  // Remover um clipe leva junto a legenda presa a ele, mas não o texto livre.
  const semB = aplicarOperacao(editada, { tipo: "remover", id: "b" });
  assert.ok(!semB.itens.some((i) => i.id === "leg") && semB.itens.some((i) => i.id === "txt"));

  // Operações inválidas são recusadas sem alterar nada.
  assert.throws(() => aplicarOperacao(t, { tipo: "cortar", id: "a", inicioSeg: 3, fimSeg: 3.05 }), /Corte inválido/);
  assert.throws(() => aplicarOperacao(t, { tipo: "alterar", id: "a", campos: { velocidade: 20 } }), /Velocidade/);
  assert.throws(() => aplicarOperacao(t, { tipo: "alterar", id: "a", campos: { id: "x" } }), /não é alterado/);
  assert.throws(() => aplicarOperacao(t, { tipo: "mover", id: "a", inicioSeg: 5 }), /reposicionar/);
  assert.throws(() => aplicarOperacao(t, { tipo: "formato", formato: { largura: 1081 } }), /pares/);
  assert.throws(() => aplicarOperacao(t, { tipo: "remover", id: "nao-existe" }));
  assert.throws(() => aplicarOperacao(t, { tipo: "inserir", item: clipe("a", 1) }), /repetido/);
});

test("estilos de edição: os nove pedidos existem, são independentes do perfil e podem ser combinados", () => {
  const ids = app.estilos.listar().map((e) => e.id);
  for (const id of ["gameplay", "acao", "humor", "trailer", "cinematografia", "demonstracao", "eventos", "recrutamento", "divulgacao-comercial"]) assert.ok(ids.includes(id), id);
  assert.ok(app.estilos.obter("padrao").indicadoPara.length === 0 && app.estilos.obter("acao").efeitos.length === 1);

  const { estilo, divergencias } = app.estilos.combinar(["acao", "cinematografia"]);
  assert.deepEqual([estilo.id, estilo.duracaoDoPlanoSeg, estilo.transicao.tipo, estilo.zoomLentoEmPlanosParados], ["acao+cinematografia", 1.5, "corte", true]);
  assert.deepEqual(estilo.efeitos.map((e) => e.tipo), ["cor", "barras-de-cinema"], "um efeito de cada tipo; o do primeiro estilo prevalece");
  assert.equal(estilo.efeitos[0].tipo === "cor" && estilo.efeitos[0].saturacao, 1.15);
  assert.equal(divergencias.length, 2);
  assert.equal(app.estilos.combinar([]).estilo.id, "padrao");
  assert.throws(() => app.estilos.combinar(["nao-existe"]));
});

test("montagem: só com plano aprovado; escolhe recursos pelo contexto e explica cada escolha", () => {
  assert.throws(() => app.edicao.montar(projetoId), /aprovado/);
  assert.throws(() => app.edicao.previa(projetoId), /aprovado/);
  const plano = app.producao.aprovarPlano(projetoId);

  const montada = app.edicao.montar(projetoId, { estilos: ["trailer", "cinematografia"] });
  const t = montada.timeline;
  assert.deepEqual([montada.versao, montada.autor, t.formato.largura, t.formato.altura], [1, "ia", 1080, 1920]);
  const clipes = t.itens.filter((i): i is ItemVideo => i.tipo === "video");
  assert.equal(clipes.length, (plano.plano as { clipes: unknown[] }).clipes.length);
  assert.ok(clipes.every((c) => existsSync(c.arquivo) && c.enquadramento.modo === "preencher"));

  // Taxa de quadros: os originais têm 30 e 60, então vale a do formato do projeto.
  assert.equal(t.formato.fps, 30);
  assert.match(montada.decisoes.find((d) => d.aspecto === "taxa-de-quadros")?.decisao ?? "", /taxas diferentes/);
  // Barras de cinema: o estilo as propõe, mas o formato é vertical — não são aplicadas.
  assert.equal(t.efeitosGlobais.length, 0);
  assert.match(montada.decisoes.find((d) => d.aspecto === "efeito/barras-de-cinema")?.decisao ?? "", /não aplicadas/);
  // Zoom lento: só nos planos parados, nunca no trecho de ação.
  const daAcao = clipes.filter((c) => c.arquivo.endsWith("01-acao.mp4") && c.inicioOrigemSeg >= 4);
  assert.ok(daAcao.length > 0 && daAcao.every((c) => !c.efeitos.some((e) => e.tipo === "zoom-lento")));
  assert.ok(clipes.every((c) => c.efeitos.filter((e) => e.tipo === "cor").length === 1), "uma única correção de cor por clipe");
  // CTA: o estilo trailer pede cartão animado no final.
  const cartao = t.itens.find((i) => i.tipo === "cartao");
  assert.deepEqual([cartao?.tipo === "cartao" && cartao.titulo, cartao?.tipo === "cartao" && cartao.subtitulo], ["Entre no nosso Discord", "Cidade Alta"]);
  assert.ok(Math.abs(t.duracaoSeg - (cartao!.inicioSeg + cartao!.duracaoSeg)) < 0.01);
  assert.ok(t.itens.some((i) => i.tipo === "texto" && i.texto === "Inauguração no dia 20"), "o fato do briefing entra como texto na tela");
  assert.ok(montada.avisos.some((a) => a.includes("trilha")) && montada.avisos.some((a) => a.includes("diferente entre os estilos")));
  assert.ok(montada.decisoes.every((d) => d.aspecto && d.decisao && d.origem));

  // No estilo padrão, nada disso é aplicado: sem cor, sem zoom, CTA como texto.
  const simples = app.edicao.montar(projetoId).timeline;
  assert.ok(simples.itens.filter((i): i is ItemVideo => i.tipo === "video").every((c) => c.efeitos.length === 0));
  assert.ok(!simples.itens.some((i) => i.tipo === "cartao") && simples.itens.some((i) => i.id === "texto-cta"));
});

test("edição não destrutiva: cada alteração é uma versão nova, com histórico e volta atrás", () => {
  const montada = app.edicao.montar(projetoId, { estilos: ["trailer"] });
  const primeiro = montada.timeline.itens.find((i): i is ItemVideo => i.tipo === "video")!;
  const editada = app.edicao.editar(projetoId, [
    { tipo: "alterar", id: primeiro.id, campos: { velocidade: 0.5, enquadramento: { x: 0.3 } } },
    { tipo: "inserir", item: { id: "logo", tipo: "imagem", camada: 15, inicioSeg: 0.5, duracaoSeg: 1.5, arquivo: imagem, ...visual, enquadramento: { modo: "conter", x: 0.5, y: 0.1, zoom: 0.3 } } },
  ]);
  assert.deepEqual([editada.versao, editada.autor], [montada.versao + 1, "usuario"]);
  assert.match(editada.nota, /Alterado item .*velocidade.*Inserido item "logo"/);
  assert.equal((app.edicao.timeline(projetoId, montada.versao).timeline.itens.find((i) => i.id === primeiro.id) as ItemVideo).velocidade, 1, "a versão anterior continua intacta");

  const comTrilha = app.edicao.definirTrilha(projetoId, musica, 0.5);
  const trilha = comTrilha.timeline.itens.find((i) => i.id === "trilha");
  assert.ok(trilha?.tipo === "audio" && trilha.papel === "trilha" && Math.abs(trilha.duracaoSeg - comTrilha.timeline.duracaoSeg) < 0.01);
  assert.equal(app.edicao.definirTrilha(projetoId, musica, 0.4).timeline.itens.filter((i) => i.id === "trilha").length, 1, "trocar a trilha não duplica");

  const desfeita = app.edicao.restaurar(projetoId);
  assert.equal(desfeita.versao, comTrilha.versao + 2);
  assert.equal((desfeita.timeline.itens.find((i) => i.id === "trilha") as { volume: number }).volume, 0.5, "desfazer volta à versão anterior");
  assert.equal(app.edicao.historico(projetoId).length, desfeita.versao);
  assert.throws(() => app.edicao.editar(projetoId, { tipo: "remover", id: "nao-existe" }));
  assert.equal(app.edicao.timeline(projetoId).versao, desfeita.versao, "uma operação inválida não cria versão");
});

test("prévia: render real em baixa qualidade, com progresso, conferência e originais intactos", async () => {
  const versao = app.edicao.timeline(projetoId);
  const progressos: number[] = [];
  const fases = new Set<string>();
  const ouvir = (p: { fase: string; progresso: number }) => { progressos.push(p.progresso); fases.add(p.fase); };
  app.eventos.on("render:progresso", ouvir);
  const tarefa = app.edicao.previa(projetoId);
  assert.equal(tarefa.exportacao.estado, "na-fila");
  const previa = await tarefa.conclusao;
  app.eventos.off("render:progresso", ouvir);

  assert.equal(previa.estado, "concluida", previa.erro ?? "");
  assert.deepEqual([previa.tipo, previa.versaoDaTimeline, previa.largura, previa.altura, previa.fps, previa.progresso], ["previa", versao.versao, 360, 640, 30, 1]);
  assert.deepEqual(previa.verificacao, { aprovada: true, problemas: [] });
  assert.ok(previa.arquivo?.includes(path.join("projetos", projetoId, "previas")) && existsSync(previa.arquivo));
  assert.ok(Math.abs((previa.duracaoSeg ?? 0) - versao.timeline.duracaoSeg) < 0.25);
  const tecnico = await sondar(previa.arquivo!);
  assert.deepEqual([tecnico.codecVideo, tecnico.codecAudio], ["h264", "aac"]);
  assert.ok(progressos.length > 5 && progressos.every((p, i) => i === 0 || p >= progressos[i - 1] - 1e-9), "o progresso só avança");
  assert.deepEqual([...fases].sort(), ["preparando", "renderizando"]);
  for (const [nome, original] of Object.entries(originais)) assert.equal(resumo(bruto(nome)), original, `${nome} foi alterado`);
});

test("exportação final: MP4 H.264 + AAC em 1080×1920 na pasta Exportações, sem sobrescrever exportações anteriores", async () => {
  const final = await app.edicao.exportar(projetoId).conclusao;
  assert.equal(final.estado, "concluida", final.erro ?? "");
  assert.deepEqual([final.largura, final.altura, final.fps, final.tentativas], [1080, 1920, 30, 1]);
  // O controle de qualidade conferiu o arquivo: nenhuma verificação obrigatória falhou.
  const relatorio = app.qualidade.relatorioDaExportacao(final.id)!;
  assert.notEqual(relatorio.situacao, "reprovado");
  assert.ok(!relatorio.verificacoes.some((v) => v.situacao === "reprovada" && v.gravidade === "obrigatoria"));
  assert.ok(final.arquivo?.startsWith(path.join(caminhos.exportacoes, "Cidade Alta")) && final.arquivo.endsWith(".mp4"));
  assert.ok((final.tamanhoBytes ?? 0) > 50_000);
  const tecnico = await sondar(final.arquivo!);
  assert.deepEqual([tecnico.codecVideo, tecnico.codecAudio, tecnico.orientacao], ["h264", "aac", "vertical"]);

  const historico = app.edicao.exportacoes(projetoId);
  assert.deepEqual(historico.map((e) => [e.tipo, e.estado]), [["final", "concluida"], ["previa", "concluida"]], "mais recente primeiro");
  assert.deepEqual(readdirSync(path.dirname(final.arquivo!)).sort(), [path.basename(final.arquivo!), "relatorios"]);
  assert.equal(readdirSync(caminhos.temporarios).filter((nome) => /^render-/.test(nome)).length, 0, "nenhum arquivo temporário de render sobra");
});

test("formatos: horizontal 16:9 com barras de cinema e quadrado 1:1, em resolução e taxa de quadros configuráveis", async () => {
  app.edicao.editar(projetoId, [
    { tipo: "formato", formato: { largura: 1920, altura: 1080, fps: 24 } },
    { tipo: "efeito-global", efeito: { tipo: "barras-de-cinema", proporcao: 2.39 } },
  ]);
  const horizontal = await app.edicao.previa(projetoId).conclusao;
  assert.equal(horizontal.estado, "concluida", horizontal.erro ?? "");
  assert.deepEqual([horizontal.largura, horizontal.altura, horizontal.fps], [640, 360, 24]);
  const medida = await medirVisual(horizontal.arquivo!, await sondar(horizontal.arquivo!));
  assert.equal(medida.composicao.valor?.barrasDeCinema, true, "as barras aparecem no vídeo renderizado");

  app.edicao.editar(projetoId, [{ tipo: "formato", formato: { largura: 1080, altura: 1080, fps: 30 } }, { tipo: "efeito-global", efeito: { tipo: "barras-de-cinema", proporcao: 2.39 }, remover: true }]);
  const quadrado = await app.edicao.previa(projetoId).conclusao;
  assert.deepEqual([quadrado.estado, quadrado.largura, quadrado.altura, quadrado.fps], ["concluida", 360, 360, 30]);
});

test("cancelamento seguro, fila de tarefas e falha com nova tentativa", async () => {
  // Duas tarefas na fila: a primeira é cancelada durante o render, a segunda antes de começar.
  const primeira = app.edicao.exportar(projetoId);
  const segunda = app.edicao.previa(projetoId);
  const cancelar = (p: { id: number; fase: string }) => { if (p.id === primeira.exportacao.id && p.fase === "renderizando") app.edicao.cancelar(p.id); };
  app.eventos.on("render:progresso", cancelar);
  app.edicao.cancelar(segunda.exportacao.id);
  const [a, b] = await Promise.all([primeira.conclusao, segunda.conclusao]);
  app.eventos.off("render:progresso", cancelar);
  assert.deepEqual([a.estado, a.arquivo, b.estado], ["cancelada", null, "cancelada"]);
  assert.equal(readdirSync(path.join(caminhos.exportacoes, "Cidade Alta")).filter((nome) => nome.endsWith(".mp4")).length, 1, "o cancelamento não deixa arquivo na pasta de exportações");
  assert.equal(readdirSync(caminhos.temporarios).filter((nome) => /^render-/.test(nome)).length, 0);

  // Falha: um arquivo de origem que sumiu. São feitas duas tentativas e o erro fica registrado.
  const quebrada = app.edicao.editar(projetoId, { tipo: "inserir", item: clipe("sumiu", 1, { arquivo: path.join(base, "nao-existe.mp4"), camada: 5, inicioSeg: 0 }) });
  const falha = await app.edicao.previa(projetoId).conclusao;
  assert.deepEqual([falha.estado, falha.tentativas, falha.arquivo], ["falhou", 2, null]);
  assert.ok(falha.erro && falha.erro.length > 0);

  // Depois da falha, a fila continua funcionando: repetir com a versão anterior (sem o item quebrado).
  app.edicao.restaurar(projetoId, quebrada.versao - 1);
  const repetida = await app.edicao.previa(projetoId).conclusao;
  assert.equal(repetida.estado, "concluida", repetida.erro ?? "");
});

test("recuperação: exportação interrompida pelo fechamento é encerrada na abertura e o histórico persiste", async () => {
  const antes = app.edicao.exportacoes(projetoId).length;
  const versoes = app.edicao.historico(projetoId).length;
  await app.edicao.cancelarTudo();
  app.encerrar();

  // Simula a aplicação fechada no meio de um render.
  const banco = new DatabaseSync(caminhos.banco);
  banco.prepare("INSERT INTO exportacoes (projeto_id, versao_da_timeline, tipo, estado, progresso, criado_em) VALUES (?, 1, 'final', 'renderizando', 0.4, '2026-01-01')").run(projetoId);
  banco.close();

  app = new Aplicacao(caminhos);
  assert.ok(app.avisos.some((aviso) => aviso.includes("exportação(ões) interrompida(s)")));
  const historico = app.edicao.exportacoes(projetoId);
  assert.equal(historico.length, antes + 1);
  assert.deepEqual([historico[0].estado, historico[0].erro], ["falhou", "Interrompida por fechamento da aplicação"]);
  assert.equal(app.edicao.historico(projetoId).length, versoes);
  assert.ok(historico.some((e) => e.tipo === "final" && e.estado === "concluida" && existsSync(e.arquivo!)), "o vídeo exportado continua lá");
});

test("montagem com marca: arquivos copiados para o projeto, decisões da marca e aviso quando a marca muda", () => {
  const marca = app.marcas.criar("Cidade Alta Oficial");
  app.marcas.guardarArquivo(marca.id, imagem, "logo");
  app.marcas.atualizar(marca.id, { cores: [{ hex: "#1A2B3C", papel: "primaria", base: "observado", fonte: "manual, página 1" }] });
  app.marcas.marcarPronta(marca.id);
  app.projetos.atualizar(projetoId, { configuracao: { marca: marca.id } });
  try {
    const montada = app.edicao.montar(projetoId);
    const logo = montada.timeline.itens.find((i) => i.id === "logo-da-marca");
    assert.ok(logo && logo.tipo === "imagem");
    assert.ok(logo.arquivo.startsWith(path.join(app.caminhos.projetos, projetoId)), `logo copiado para o projeto: ${logo.arquivo}`);
    assert.ok(existsSync(logo.arquivo));
    assert.ok(montada.decisoes.some((d) => d.origem === "marca"));
    assert.equal(app.edicao.marcaDesatualizada(projetoId), false);

    app.marcas.atualizar(marca.id, { cores: [{ hex: "#00AA00", papel: "primaria", base: "observado", fonte: "escolhida pelo usuário" }] });
    assert.equal(app.edicao.marcaDesatualizada(projetoId), true);
    const antes = app.edicao.timeline(projetoId).timeline;
    assert.ok(JSON.stringify(antes).includes("#1A2B3C"), "a timeline montada não mudou sozinha");
    const nova = app.edicao.aplicarMarcaAtual(projetoId);
    assert.equal(nova.versao, montada.versao + 1);
    assert.ok(JSON.stringify(nova.timeline).includes("#00AA00"));
    assert.equal(app.edicao.marcaDesatualizada(projetoId), false);
  } finally {
    app.projetos.atualizar(projetoId, { configuracao: { marca: "" } });
  }
});
