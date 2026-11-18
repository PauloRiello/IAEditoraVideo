// Testes do controle de qualidade e da exportação: verificações técnicas, visuais e de
// áudio, perfis por destino, relatório, exceções, presets e proteção contra sobrescrita.
// Os arquivos são conferidos com FFmpeg e FFprobe, independentes do renderizador.
// Executar: npm test

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { AgenteDeQualidade } from "../../Pipeline/quality-control/verificador.ts";
import { ErroAplicacao } from "../../src/dominio/erros.ts";
import type { Verificacao } from "../../src/dominio/qualidade.ts";
import type { ItemVideo, Timeline } from "../../src/dominio/timeline.ts";
import { montarCaminhos } from "../../src/infra/caminhos.ts";
import { Aplicacao } from "../../src/nucleo/aplicacao.ts";
import { relatorioEmMarkdown, situacaoFinal } from "../../src/nucleo/qualidade.ts";
import { ServicoDeQualidade } from "../../src/servicos/qualidade.ts";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const base = mkdtempSync(path.join(os.tmpdir(), "iaev-qualidade-"));
const caminhos = montarCaminhos(path.join(base, "dados"), path.join(base, "biblioteca"), RAIZ);
caminhos.temporarios = path.join(RAIZ, "Dados", "temp"); // reaproveita o pacote da composição entre execuções
const arquivo = (nome: string) => path.join(base, nome);
const catalogo = new ServicoDeQualidade([path.join(RAIZ, "IA", "Qualidade")], [path.join(RAIZ, "IA", "Exportacao")]);
const agente = new AgenteDeQualidade();
const ffmpeg = (argumentos: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...argumentos], { stdio: "pipe" });
let app: Aplicacao;
let projetoId = "";

const R = "s=320x180:r=30";
const IMAGEM = ["-f", "lavfi", "-t", "4", "-i", `testsrc2=${R}`];
const SOM = ["-f", "lavfi", "-t", "4", "-i", "sine=f=330:r=48000"];
const H264 = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"];
const AAC = ["-af", "volume=2", "-c:a", "aac", "-ar", "48000"];
const WEB = ["-movflags", "+faststart"];

before(async () => {
  // Arquivos com um defeito conhecido cada um, para conferir cada verificação isoladamente.
  ffmpeg([...IMAGEM, ...SOM, ...H264, ...AAC, ...WEB, arquivo("bom.mp4")]);
  ffmpeg([...IMAGEM, ...SOM, ...H264, ...AAC, arquivo("indice-no-fim.mp4")]);
  ffmpeg([...IMAGEM, ...SOM, "-c:v", "libx265", "-preset", "ultrafast", "-pix_fmt", "yuv420p", ...AAC, ...WEB, arquivo("hevc.mp4")]);
  ffmpeg([...IMAGEM, ...SOM, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv444p", ...AAC, ...WEB, arquivo("cor-444.mp4")]);
  ffmpeg([...IMAGEM, ...H264, "-an", ...WEB, arquivo("sem-audio.mp4")]);
  ffmpeg([...IMAGEM, "-f", "lavfi", "-t", "4", "-i", "anullsrc=r=48000:cl=stereo", ...H264, "-c:a", "aac", ...WEB, arquivo("mudo.mp4")]);
  ffmpeg([...IMAGEM, ...SOM, ...H264, "-af", "volume=30", "-c:a", "aac", "-ar", "48000", ...WEB, arquivo("estourado.mp4")]);
  ffmpeg([...IMAGEM, "-f", "lavfi", "-t", "2", "-i", "sine=f=330:r=48000", ...H264, ...AAC, ...WEB, arquivo("audio-curto.mp4")]);
  ffmpeg([
    "-f", "lavfi", "-t", "1", "-i", `testsrc2=${R}`, "-f", "lavfi", "-t", "2", "-i", `color=c=black:${R}`, "-f", "lavfi", "-t", "1", "-i", `testsrc2=${R}`, ...SOM,
    "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-map", "3:a", ...H264, ...AAC, ...WEB, arquivo("preto-no-meio.mp4"),
  ]);
  writeFileSync(arquivo("truncado.mp4"), readFileSync(arquivo("indice-no-fim.mp4")).subarray(0, 4000));

  // Projeto real, com plano aprovado e timeline montada, para os testes de exportação.
  mkdirSync(caminhos.brutos, { recursive: true });
  ffmpeg([
    "-f", "lavfi", "-t", "2", "-i", "testsrc2=s=720x1280:r=30", "-f", "lavfi", "-t", "2", "-i", "smptebars=s=720x1280:r=30", "-f", "lavfi", "-t", "4", "-i", "anoisesrc=c=pink:a=0.3:r=48000",
    "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-map", "2:a", ...H264, "-c:a", "aac", "-shortest", path.join(caminhos.brutos, "material.mp4"),
  ]);
  app = new Aplicacao(caminhos);
  projetoId = app.criarProjeto("Cidade Alta", "fivem").id;
  app.producao.importarBrutos(projetoId);
  await app.producao.analisarBrutos(projetoId, { transcrever: false });
  app.producao.planejar(projetoId, { objetivo: "Divulgar", plataforma: "Instagram Reels", duracaoDesejadaSeg: 4, cta: "Entre no Discord" });
  app.producao.aprovarPlano(projetoId);
  app.edicao.montar(projetoId);
});

after(async () => {
  await app?.edicao.cancelarTudo();
  app?.encerrar();
  rmSync(base, { recursive: true, force: true });
});

/** Timeline mínima que descreve o que os arquivos de teste deveriam ser: um clipe de 4 s com som. */
const visual = { enquadramento: { modo: "preencher" as const, x: 0.5, y: 0.5, zoom: 1 }, entrada: { tipo: "corte" as const, duracaoSeg: 0 }, saida: { tipo: "corte" as const, duracaoSeg: 0 }, efeitos: [] };
const clipe = (extra: Partial<ItemVideo> = {}): ItemVideo => ({ id: "clipe-1", tipo: "video", camada: 0, inicioSeg: 0, duracaoSeg: 4, arquivo: arquivo("bom.mp4"), inicioOrigemSeg: 0, velocidade: 1, volume: 1, ...visual, ...extra });
const timeline = (extra: Partial<Timeline> = {}): Timeline => ({ versao: 1, formato: { largura: 320, altura: 180, fps: 30 }, duracaoSeg: 4, itens: [clipe()], efeitosGlobais: [], legendas: { tamanho: 0.035, caixa: true }, ...extra });
const conferir = (nome: string, t = timeline(), esperado = { largura: 320, altura: 180, fps: 30 }) =>
  agente.verificarArquivo(arquivo(nome), t, { perfil: catalogo.perfil("geral"), ctaPrevisto: false, esperado, tentativas: 1 });
const reprovadas = (lista: Verificacao[]) => lista.filter((v) => v.situacao === "reprovada").map((v) => `${v.id}:${v.gravidade}`).sort();
const obter = (lista: Verificacao[], id: string) => lista.find((v) => v.id === id)!;

test("arquivo correto passa em todas as verificações obrigatórias, técnicas e de áudio", async () => {
  const lista = await conferir("bom.mp4");
  assert.deepEqual(reprovadas(lista), []);
  for (const id of [
    "tecnica/integridade", "tecnica/codec-de-video", "tecnica/codec-de-audio", "tecnica/resolucao", "tecnica/fps", "tecnica/duracao", "tecnica/compatibilidade",
    "tecnica/compatibilidade-na-web", "tecnica/quadros-pretos", "audio/presenca", "audio/inaudivel", "audio/sincronia", "audio/volume", "audio/picos", "audio/distorcao",
    "audio/cortes-de-audio", "audio/diferencas-de-volume",
  ]) assert.equal(obter(lista, id)?.situacao, "aprovada", id);
  assert.ok(lista.every((v) => v.nome && v.detalhe && ["tecnica", "visual", "audio", "destino"].includes(v.grupo)));
  assert.match(obter(lista, "audio/volume").detalhe, /LUFS/);
  assert.match(obter(lista, "tecnica/compatibilidade").detalhe, /yuv420p/);
});

test("cada defeito técnico é apontado com a gravidade certa e uma sugestão de correção", async () => {
  assert.deepEqual(reprovadas(await conferir("hevc.mp4")), ["tecnica/codec-de-video:obrigatoria"]);
  assert.deepEqual(reprovadas(await conferir("cor-444.mp4")), ["tecnica/compatibilidade:obrigatoria"]);
  assert.deepEqual(reprovadas(await conferir("indice-no-fim.mp4")), ["tecnica/compatibilidade-na-web:recomendacao"]);
  assert.deepEqual(reprovadas(await conferir("bom.mp4", timeline(), { largura: 640, altura: 360, fps: 60 })), ["tecnica/fps:obrigatoria", "tecnica/resolucao:obrigatoria"]);
  assert.deepEqual(reprovadas(await conferir("bom.mp4", timeline({ duracaoSeg: 9 }))), ["tecnica/duracao:obrigatoria"]);

  const truncado = await conferir("truncado.mp4");
  assert.deepEqual(reprovadas(truncado), ["tecnica/integridade:obrigatoria"]);
  assert.equal(truncado.length, 1, "sem conseguir abrir o arquivo, nada mais é afirmado");
  assert.deepEqual(reprovadas(await conferir("nao-existe.mp4")), ["tecnica/integridade:obrigatoria"]);

  const preto = await conferir("preto-no-meio.mp4");
  assert.ok(reprovadas(preto).includes("tecnica/quadros-pretos:importante"));
  assert.deepEqual([obter(preto, "tecnica/quadros-pretos").inicioSeg, obter(preto, "tecnica/quadros-pretos").fimSeg], [1, 3]);
  assert.ok(preto.filter((v) => v.situacao === "reprovada").every((v) => v.sugestao.length > 0), "todo problema traz uma sugestão");

  // Tela preta esperada (fade final) não é defeito; segunda tentativa de render vira ressalva.
  const comFade = timeline({ itens: [clipe({ saida: { tipo: "fade", duracaoSeg: 3 } })] });
  assert.equal(obter(await conferir("preto-no-meio.mp4", comFade), "tecnica/quadros-pretos").situacao, "aprovada");
  const segundaTentativa = await agente.verificarArquivo(arquivo("bom.mp4"), timeline(), { perfil: catalogo.perfil("geral"), ctaPrevisto: false, esperado: { largura: 320, altura: 180, fps: 30 }, tentativas: 2 });
  assert.deepEqual(reprovadas(segundaTentativa), ["tecnica/erros-de-render:recomendacao"]);
});

test("verificações de áudio: ausente, mudo, estourado e fora de sincronia", async () => {
  assert.deepEqual(reprovadas(await conferir("sem-audio.mp4")), ["audio/presenca:obrigatoria"]);
  // A mesma falta de áudio não é defeito se a timeline não tinha som.
  assert.deepEqual(reprovadas(await conferir("sem-audio.mp4", timeline({ itens: [clipe({ volume: 0 })] }))), []);
  assert.deepEqual(reprovadas(await conferir("mudo.mp4")), ["audio/inaudivel:importante"]);

  const estourado = await conferir("estourado.mp4");
  assert.ok(["audio/distorcao:importante", "audio/picos:importante"].every((id) => reprovadas(estourado).includes(id)), reprovadas(estourado).join(","));
  assert.match(obter(estourado, "audio/picos").detalhe, /dBFS/);

  const curto = await conferir("audio-curto.mp4");
  assert.ok(reprovadas(curto).some((id) => id.startsWith("audio/sincronia:")), reprovadas(curto).join(","));
  assert.match(obter(curto, "audio/sincronia").detalhe, /diferem em 2/);
});

test("verificações da timeline: arquivos ausentes, textos, legendas, áreas seguras, efeitos e trilha", async () => {
  const redes = { perfil: catalogo.perfil("redes-sociais"), ctaPrevisto: true };
  const vertical = { largura: 1080, altura: 1920, fps: 30 };
  const texto = (extra = {}) => ({ id: "t1", tipo: "texto" as const, camada: 20, inicioSeg: 0, duracaoSeg: 3, texto: "Inauguração no dia 20", posicao: "topo" as const, tamanho: 0.045, cor: "#ffffff", fundo: "", animacao: "surgir" as const, ...extra });
  const legenda = (textoDaLegenda: string, duracaoSeg = 3) => ({ id: "l1", tipo: "legenda" as const, camada: 10, inicioSeg: 0, duracaoSeg, texto: textoDaLegenda });
  const cta = { id: "texto-cta", tipo: "texto" as const, camada: 20, inicioSeg: 1, duracaoSeg: 3, texto: "Entre no Discord", posicao: "centro" as const, tamanho: 0.05, cor: "#ffffff", fundo: "rgba(0,0,0,0.6)", animacao: "subir" as const };
  const boa = timeline({ formato: vertical, itens: [clipe(), texto(), legenda("Bem-vindo à cidade"), cta], areaSegura: { topo: 0.1, base: 0.2, lados: 0.06 } });
  assert.deepEqual(reprovadas(await agente.verificarTimeline(boa, redes)), ["visual/enquadramento:recomendacao"], "só o aviso de ampliação do material pequeno");

  const ruim = timeline({
    formato: vertical, duracaoSeg: 4, legendas: { tamanho: 0.02, caixa: true }, efeitosGlobais: [{ tipo: "barras-de-cinema", proporcao: 2.39 }],
    itens: [
      clipe({ arquivo: arquivo("sumiu.mp4"), efeitos: [{ tipo: "cor", saturacao: 2, contraste: 1, brilho: 1 }] }),
      texto({ tamanho: 0.02, duracaoSeg: 0.5 }),
      legenda("Esta legenda é longa demais para ser lida de uma só vez por alguém que está assistindo ao vídeo no celular, sem pausar.", 2),
      { id: "trilha", tipo: "audio", papel: "trilha", camada: 0, inicioSeg: 0, duracaoSeg: 2, arquivo: arquivo("bom.mp4"), inicioOrigemSeg: 3, volume: 0.6, fadeDeEntradaSeg: 0, fadeDeSaidaSeg: 0, reduzirEm: [], volumeReduzido: 0.2 },
    ],
  });
  const lista = await agente.verificarTimeline(ruim, redes);
  assert.deepEqual(reprovadas(lista), [
    "audio/trilha:importante", "destino/cta:importante", "tecnica/arquivos-ausentes:obrigatoria", "visual/areas-seguras:importante", "visual/efeitos:recomendacao",
    "visual/legendas:importante", "visual/legibilidade-dos-textos:importante",
  ]);
  assert.match(obter(lista, "tecnica/arquivos-ausentes").detalhe, /sumiu\.mp4/);
  assert.match(obter(lista, "visual/legibilidade-dos-textos").detalhe, /letra com 2% da altura.*fica 0\.5 s na tela/s);
  assert.match(obter(lista, "visual/areas-seguras").detalhe, /rodapé de 14%.*pede 20%/);
  assert.match(obter(lista, "visual/areas-seguras").sugestao, /apresentacao/);
  assert.match(obter(lista, "audio/trilha").detalhe, /cobre 2 s de um vídeo de 4 s.*termina 1 s antes/s);
  assert.match(obter(lista, "visual/efeitos").detalhe, /Barras de cinema.*correção de cor extrema/s);
  assert.match(obter(lista, "destino/cta").detalhe, /plano previa/);
  assert.equal(obter(lista, "visual/elementos-fora-da-tela").situacao, "aprovada");
  const enorme = await agente.verificarTimeline(timeline({ formato: vertical, itens: [clipe(), texto({ texto: "Superinauguraçãoextraordinariamentelonga", tamanho: 0.12 })] }), redes);
  assert.equal(obter(enorme, "visual/elementos-fora-da-tela").situacao, "reprovada");
});

test("perfis de qualidade: cada destino tem os seus critérios; regras de redes sociais não valem para tudo", async () => {
  const horizontal = timeline({ formato: { largura: 1920, altura: 1080, fps: 30 }, duracaoSeg: 200, itens: [clipe({ duracaoSeg: 200 })] });
  const por = async (perfil: string) => agente.verificarTimeline(horizontal, { perfil: catalogo.perfil(perfil), ctaPrevisto: false });

  const redes = await por("redes-sociais");
  assert.ok(["destino/proporcao:importante", "destino/duracao:importante", "destino/ritmo:recomendacao", "destino/cta:recomendacao"].every((id) => reprovadas(redes).includes(id)), reprovadas(redes).join(","));

  for (const perfil of ["documentario", "institucional"]) {
    const lista = await por(perfil);
    assert.ok(!reprovadas(lista).some((id) => id.startsWith("destino/")), `${perfil}: ${reprovadas(lista).join(",")}`);
    for (const id of ["destino/duracao", "destino/ritmo", "destino/cta"]) assert.equal(obter(lista, id).situacao, "nao-aplicavel", `${perfil} ${id}`);
  }
  const youtube = await por("youtube");
  assert.equal(obter(youtube, "destino/proporcao").situacao, "aprovada");
  assert.deepEqual(reprovadas(youtube).filter((id) => id.startsWith("destino/")), ["destino/ritmo:recomendacao"], "o YouTube pede ritmo, mas não limita duração nem exige CTA");

  // A abertura só é avaliada onde o destino pede.
  const abertura = async (perfil: string) => obter(await agente.verificarArquivo(arquivo("bom.mp4"), timeline(), { perfil: catalogo.perfil(perfil), ctaPrevisto: false, esperado: { largura: 320, altura: 180, fps: 30 }, tentativas: 1 }), "destino/abertura").situacao;
  assert.deepEqual([await abertura("redes-sociais"), await abertura("documentario")], ["aprovada", "nao-aplicavel"]);

  // Escolha do perfil: pedido explícito, plataforma do briefing, perfil do projeto e, por fim, formato.
  const escolher = (c: Parameters<ServicoDeQualidade["escolherPerfil"]>[0]) => catalogo.escolherPerfil(c).id;
  assert.equal(escolher({ pedido: "documentario", plataforma: "TikTok", vertical: true }), "documentario");
  assert.equal(escolher({ plataforma: "Instagram Reels", perfilDoProjeto: "institucional", vertical: false }), "redes-sociais");
  assert.equal(escolher({ plataforma: "Canal no YouTube", vertical: false }), "youtube");
  assert.equal(escolher({ perfilDoProjeto: "institucional", vertical: false }), "institucional");
  assert.equal(escolher({ perfilDoProjeto: "fivem", vertical: true }), "redes-sociais");
  assert.equal(escolher({ perfilDoProjeto: "fivem", vertical: false }), "geral");
  assert.throws(() => escolher({ pedido: "nao-existe", vertical: true }));
});

test("situação final e exceções: obrigatória reprovada nunca é aprovada nem aceita", async () => {
  const v = (id: string, gravidade: Verificacao["gravidade"], situacao: Verificacao["situacao"] = "reprovada"): Verificacao => ({ id, grupo: "tecnica", nome: id, situacao, gravidade, detalhe: "d", sugestao: "s", base: "observado" });
  assert.equal(situacaoFinal([v("a", "obrigatoria", "aprovada"), v("b", "recomendacao", "nao-aplicavel")], []), "aprovado");
  assert.equal(situacaoFinal([v("a", "recomendacao")], []), "aprovado-com-ressalvas");
  assert.equal(situacaoFinal([v("a", "importante")], []), "pendente");
  assert.equal(situacaoFinal([v("a", "importante")], [{ verificacaoId: "a", justificativa: "ok", aceitaEm: "x" }]), "aprovado-com-ressalvas");
  assert.equal(situacaoFinal([v("a", "obrigatoria"), v("b", "importante")], [{ verificacaoId: "a", justificativa: "forçar", aceitaEm: "x" }, { verificacaoId: "b", justificativa: "ok", aceitaEm: "x" }]), "reprovado");

  // Na aplicação: texto pequeno demais deixa a timeline pendente até o usuário decidir.
  app.edicao.editar(projetoId, [
    { tipo: "inserir", item: { id: "aviso", tipo: "texto", camada: 20, inicioSeg: 0, duracaoSeg: 3, texto: "Vagas limitadas", posicao: "topo", tamanho: 0.02, cor: "#ffffff", fundo: "#000000", animacao: "surgir" } },
    { tipo: "inserir", item: clipe({ id: "sumiu", camada: 5, duracaoSeg: 1, arquivo: arquivo("nao-existe.mp4") }) },
  ]);
  const relatorio = await app.qualidade.verificarTimeline(projetoId);
  assert.deepEqual([relatorio.perfilDeQualidade, relatorio.situacao, relatorio.exportacaoId], ["redes-sociais", "reprovado", null]);
  assert.throws(() => app.qualidade.aceitarExcecao(relatorio.id, "tecnica/arquivos-ausentes", "Sei que falta"), (e: unknown) => e instanceof ErroAplicacao && e.codigo === "excecao-nao-permitida");
  assert.throws(() => app.qualidade.aceitarExcecao(relatorio.id, "visual/legibilidade-dos-textos", "   "), /Informe por que/);
  assert.throws(() => app.qualidade.aceitarExcecao(relatorio.id, "tecnica/conteudo", "x"), /não tem problema/);
  assert.throws(() => app.qualidade.aceitarExcecao(relatorio.id, "nao/existe", "x"));
  const aceito = app.qualidade.aceitarExcecao(relatorio.id, "visual/legibilidade-dos-textos", "É só um aviso legal, pode ser pequeno");
  assert.equal(aceito.situacao, "reprovado", "aceitar um problema não crítico não apaga a falha obrigatória");
  assert.equal(aceito.excecoes[0].justificativa, "É só um aviso legal, pode ser pequeno");

  // Exportar com falha obrigatória: a exportação não começa e nada chega à pasta Exportações.
  const bloqueada = await app.edicao.exportar(projetoId).conclusao;
  assert.deepEqual([bloqueada.estado, bloqueada.arquivo, bloqueada.tentativas, bloqueada.verificacao?.aprovada], ["falhou", null, 0, false]);
  assert.match(bloqueada.erro ?? "", /não foi iniciada.*nao-existe\.mp4/);
  assert.ok(!existsSync(path.join(caminhos.exportacoes, "Cidade Alta")));

  // Sem o arquivo ausente, resta a pendência do texto: aceita, o relatório fica aprovado com ressalvas.
  app.edicao.editar(projetoId, { tipo: "remover", id: "sumiu" });
  const pendente = await app.qualidade.verificarTimeline(projetoId);
  assert.equal(pendente.situacao, "pendente");
  const resolvido = app.qualidade.aceitarExcecao(pendente.id, "visual/legibilidade-dos-textos", "É só um aviso legal");
  assert.equal(resolvido.situacao, "aprovado-com-ressalvas");
  const markdown = relatorioEmMarkdown(resolvido, "Cidade Alta");
  for (const trecho of ["# Relatório de qualidade: Cidade Alta", "## Situação final: Aprovado com ressalvas", "## Problemas encontrados", "Aceita: É só um aviso legal", "## Verificações aprovadas", "Como corrigir"]) {
    assert.ok(markdown.includes(trecho), `relatório sem "${trecho}"`);
  }
  app.edicao.editar(projetoId, { tipo: "remover", id: "aviso" });
});

test("exportação com preset: arquivo conferido por ferramentas independentes, relatório, versão no nome e nenhuma sobrescrita", async () => {
  assert.deepEqual(app.catalogoDeQualidade.listarPresets().map((p) => p.id).sort(), ["alta-qualidade", "horizontal-1080", "horizontal-720", "padrao", "quadrado-1080", "vertical-1080", "vertical-720"]);
  assert.throws(() => app.edicao.exportar(projetoId, { preset: "horizontal-1080" }), (e: unknown) => e instanceof ErroAplicacao && e.codigo === "preset-incompativel");
  assert.throws(() => app.edicao.exportar(projetoId, { preset: "nao-existe" }));

  const versao = app.edicao.timeline(projetoId);
  const fases = new Set<string>();
  const ouvir = (p: { fase: string }) => fases.add(p.fase);
  app.eventos.on("render:progresso", ouvir);
  const exportada = await app.edicao.exportar(projetoId, { preset: "vertical-720" }).conclusao;
  app.eventos.off("render:progresso", ouvir);
  assert.equal(exportada.estado, "concluida", exportada.erro ?? "");
  assert.deepEqual([exportada.largura, exportada.altura, exportada.fps, exportada.preset], [720, 1280, 30, "vertical-720"]);
  assert.ok(fases.has("conferindo"));
  const pasta = path.join(caminhos.exportacoes, "Cidade Alta");
  assert.match(path.basename(exportada.arquivo!), new RegExp(`^Cidade Alta v${versao.versao} vertical-720 \\d{8}-\\d{6}\\.mp4$`));
  assert.equal(path.dirname(exportada.arquivo!), pasta);

  // Conferência independente do renderizador: FFprobe lê o arquivo e FFmpeg o decodifica inteiro.
  const sonda = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", exportada.arquivo!]).toString()) as { streams: { codec_name: string; pix_fmt?: string; width?: number; height?: number }[]; format: { format_name: string; duration: string } };
  assert.deepEqual(sonda.streams.map((s) => s.codec_name).sort(), ["aac", "h264"]);
  assert.deepEqual([sonda.streams.find((s) => s.width)?.width, sonda.streams.find((s) => s.width)?.height, sonda.streams.find((s) => s.pix_fmt)?.pix_fmt], [720, 1280, "yuv420p"]);
  assert.ok(sonda.format.format_name.includes("mp4") && Math.abs(Number(sonda.format.duration) - versao.timeline.duracaoSeg) < 0.25);
  assert.equal(execFileSync("ffmpeg", ["-v", "error", "-i", exportada.arquivo!, "-f", "null", "-"], { stdio: "pipe" }).toString(), "");

  // Relatório: gravado no banco e em arquivo, ligado à exportação, sem falha obrigatória.
  const relatorio = app.qualidade.relatorioDaExportacao(exportada.id)!;
  assert.deepEqual([relatorio.perfilDeQualidade, relatorio.arquivo, relatorio.versaoDaTimeline], ["redes-sociais", exportada.arquivo, versao.versao]);
  assert.notEqual(relatorio.situacao, "reprovado");
  assert.ok(relatorio.verificacoes.length >= 30 && !relatorio.verificacoes.some((v) => v.situacao === "reprovada" && v.gravidade === "obrigatoria"));
  assert.equal(obter(relatorio.verificacoes, "visual/areas-seguras").situacao, "aprovada", "a montagem já usa as margens do destino");
  assert.equal(exportada.verificacao?.aprovada, relatorio.situacao !== "pendente");
  const emArquivo = path.join(pasta, "relatorios", `${path.basename(exportada.arquivo!, ".mp4")}.md`);
  assert.match(readFileSync(emArquivo, "utf8"), /## Situação final/);

  // Pendências não críticas: o usuário aceita uma a uma, com justificativa.
  let atual = relatorio;
  for (const pendencia of relatorio.verificacoes.filter((v) => v.situacao === "reprovada" && v.gravidade === "importante")) {
    atual = app.qualidade.aceitarExcecao(relatorio.id, pendencia.id, "Aceito para este teste");
  }
  assert.ok(["aprovado", "aprovado-com-ressalvas"].includes(atual.situacao));
  if (atual.excecoes.length) {
    // A decisão aparece no relatório em arquivo e no histórico da exportação.
    assert.match(readFileSync(emArquivo, "utf8"), /Aceita: Aceito para este teste/);
    assert.equal(app.edicao.exportacoes(projetoId)[0].verificacao?.aprovada, true);
  }

  // Repetir a exportação cria outro arquivo: o anterior não é sobrescrito.
  const repetida = await app.edicao.repetir(exportada.id).conclusao;
  assert.deepEqual([repetida.estado, repetida.preset, repetida.versaoDaTimeline], ["concluida", "vertical-720", versao.versao]);
  assert.notEqual(repetida.arquivo, exportada.arquivo);
  assert.equal(readdirSync(pasta).filter((nome) => nome.endsWith(".mp4")).length, 2);
  assert.ok(existsSync(exportada.arquivo!));
  assert.deepEqual(app.edicao.exportacoes(projetoId).slice(0, 2).map((e) => [e.id, e.estado]), [[repetida.id, "concluida"], [exportada.id, "concluida"]]);
  assert.equal(readdirSync(path.join(caminhos.projetos, projetoId, "em-conferencia")).length, 0, "a área de espera fica vazia");
});

test("vídeo reprovado depois do render não entra em Exportações; relatórios persistem após reabrir", async () => {
  const pasta = path.join(caminhos.exportacoes, "Cidade Alta");
  const antes = readdirSync(pasta).filter((nome) => nome.endsWith(".mp4")).length;
  // Simula um defeito do arquivo renderizado que só a conferência independente enxerga.
  const original = app.qualidade.agente.verificarArquivo.bind(app.qualidade.agente);
  app.qualidade.agente.verificarArquivo = async (...argumentos) => [
    ...(await original(...argumentos)).filter((v) => v.id !== "tecnica/codec-de-video"),
    { id: "tecnica/codec-de-video", grupo: "tecnica", nome: "Codec de vídeo", situacao: "reprovada", gravidade: "obrigatoria", detalhe: "Vídeo em outro codec.", sugestao: "Exporte de novo.", base: "observado" },
  ];
  const reprovada = await app.edicao.exportar(projetoId, { preset: "vertical-720" }).conclusao;
  app.qualidade.agente.verificarArquivo = original;

  assert.deepEqual([reprovada.estado, reprovada.verificacao?.aprovada], ["falhou", false]);
  assert.match(reprovada.erro ?? "", /Reprovado no controle de qualidade.*Codec de vídeo/);
  assert.ok(reprovada.arquivo?.includes(path.join("projetos", projetoId, "reprovados")) && existsSync(reprovada.arquivo), "o arquivo reprovado fica guardado à parte");
  assert.equal(readdirSync(pasta).filter((nome) => nome.endsWith(".mp4")).length, antes, "nada novo em Exportações");
  const relatorio = app.qualidade.relatorioDaExportacao(reprovada.id)!;
  assert.equal(relatorio.situacao, "reprovado");
  assert.throws(() => app.qualidade.aceitarExcecao(relatorio.id, "tecnica/codec-de-video", "Deixa passar"), /obrigatória/);
  assert.match(app.qualidade.markdown(relatorio.id), /Situação final: Reprovado.*Não pode ser aceita/s);

  const total = app.qualidade.relatorios(projetoId).length;
  await app.edicao.cancelarTudo();
  app.encerrar();
  app = new Aplicacao(caminhos);
  assert.equal(app.qualidade.relatorios(projetoId).length, total);
  assert.ok(app.qualidade.relatorios(projetoId).some((r) => r.excecoes.length > 0), "as exceções aceitas continuam registradas");
  assert.equal(app.qualidade.relatorioDaExportacao(reprovada.id)?.situacao, "reprovado");
});
