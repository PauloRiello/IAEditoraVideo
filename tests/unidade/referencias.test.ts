// Testes do analisador de referências, com vídeos de exemplo gerados pelo FFmpeg
// (cada um com uma característica conhecida). Executar: npm test

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { analisarReferencia } from "../../Pipeline/analysis/analisador.ts";
import type { PedidoImagens, PedidoTexto, ProvedorIA } from "../../src/dominio/provedores.ts";
import type { Perfil } from "../../src/dominio/tipos.ts";
import { montarCaminhos } from "../../src/infra/caminhos.ts";
import { Aplicacao } from "../../src/nucleo/aplicacao.ts";
import { ServicoPerfis } from "../../src/servicos/perfis.ts";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const pasta = mkdtempSync(path.join(os.tmpdir(), "iaev-referencias-"));
const amostra = (nome: string) => path.join(pasta, `${nome}.mp4`);
const perfis = new ServicoPerfis([path.join(RAIZ, "IA", "Perfis")]);
const perfil = (id: string): Perfil => perfis.obter(id);
let temFala = false;

before(() => {
  const R = "s=320x180:r=30";
  const quadroParado = ["-f", "lavfi", "-i", "testsrc2=s=640x360:r=1:d=1"];
  const saida = (nome: string) => ["-c:v", "libx264", "-pix_fmt", "yuv420p", amostra(nome)];
  const rodar = (argumentos: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...argumentos], { stdio: "pipe" });

  // "trailer": 8 planos de 1,5 s em corte seco, com batida a 120 por minuto (cortes sobre as batidas).
  const fontes = ["testsrc2", "smptebars", "color=c=red", "rgbtestsrc", "color=c=0x2040a0", "yuvtestsrc", "color=c=0x20a040", "pal75bars"];
  rodar([
    ...fontes.flatMap((fonte) => ["-f", "lavfi", "-t", "1.5", "-i", `${fonte}${fonte.includes("=") ? ":" : "="}${R}`]),
    "-f", "lavfi", "-t", "12", "-i", "aevalsrc='0.8*sin(2*PI*220*t)*lt(mod(t,0.5),0.05)':s=44100",
    "-filter_complex", `${fontes.map((_, i) => `[${i}:v]`).join("")}concat=n=${fontes.length}:v=1:a=0[v]`,
    "-map", "[v]", "-map", `${fontes.length}:a`, "-c:a", "aac", "-shortest", ...saida("trailer"),
  ]);
  // "dissolucao": dois planos unidos por dissolução de 1 s, fade para preto no fim, sem áudio.
  rodar([
    "-f", "lavfi", "-t", "4", "-i", `smptebars=${R}`, "-f", "lavfi", "-t", "4", "-i", `rgbtestsrc=${R}`,
    "-filter_complex", "[0:v][1:v]xfade=transition=fade:duration=1:offset=3,fade=t=out:st=6:d=1[v]", "-map", "[v]", ...saida("dissolucao"),
  ]);
  rodar([...quadroParado, "-vf", "zoompan=z='1+0.2*on/30':d=120:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=320x180:fps=30", "-frames:v", "120", ...saida("zoom")]);
  rodar([...quadroParado, "-vf", "zoompan=z=1.5:x='on*1.5':y=40:d=120:s=320x180:fps=30", "-frames:v", "120", ...saida("panoramica")]);
  rodar([...quadroParado, "-vf", "zoompan=z=1:d=90:s=320x136:fps=30,pad=320:180:0:22:black", "-frames:v", "90", ...saida("barras")]);
  try {
    // "fala": voz sintética sobre fundo liso. Depende do filtro flite do FFmpeg.
    rodar([
      "-f", "lavfi", "-i", "flite=text='Welcome to the city. This is the best role play server. Join our discord today.':voice=slt",
      "-f", "lavfi", "-i", `color=c=0x203040:${R}`, "-c:a", "aac", "-shortest", ...saida("fala"),
    ]);
    temFala = true;
  } catch {
    temFala = false;
  }
});

after(() => rmSync(pasta, { recursive: true, force: true }));

test("mede cortes, ritmo, batidas e sincronia de um vídeo com cortes na batida", async () => {
  const r = await analisarReferencia(amostra("trailer"), { titulo: "Trailer", perfil: perfil("fivem") });

  assert.deepEqual(r.visual.transicoes.map((t) => [t.tempoSeg, t.tipo]), [1.5, 3, 4.5, 6, 7.5, 9, 10.5].map((t) => [t, "corte-seco"]));
  assert.equal(r.visual.ritmo.base, "observado");
  assert.deepEqual([r.visual.ritmo.valor?.planos, r.visual.ritmo.valor?.cortesPorMinuto, r.visual.ritmo.valor?.duracaoMedianaSeg], [8, 35, 1.5]);
  assert.equal(r.visual.amostragem.quadrosAnalisados, 96, "8 quadros por segundo em vez dos 360 do vídeo");
  assert.equal(r.visual.amostragem.quadrosDoVideo, 360);

  assert.equal(r.audio?.batidas.valor?.bpm, 120);
  assert.deepEqual([r.audio?.sincroniaComCortes.valor?.cortesNaBatida, r.audio?.sincroniaComCortes.valor?.cortesAvaliados], [7, 7]);
  assert.ok((r.audio?.pontosDeCorteMusical.valor?.length ?? 0) >= 12);
  assert.equal(r.audio?.pontosDeCorteMusical.base, "estimado");

  const estilo = r.perfilDeEstilo;
  assert.equal(estilo["ritmo/cadencia-de-cortes"], "rapido");
  assert.equal(estilo["duracao-planos/duracao-tipica"], "media");
  assert.equal(estilo["transicoes/tipo-predominante"], "corte-seco");
  assert.equal(estilo["sincronizacao-musical/cortes-na-batida"], "sim");
  assert.equal(estilo["trilha-sonora/andamento"], "medio");
  for (const regra of r.regras) {
    assert.ok(regra.descricao && regra.exemplo, `regra ${regra.chave} sem descrição ou exemplo de aplicação`);
    assert.ok(regra.confianca > 0 && regra.confianca <= 1);
  }
  assert.ok(r.confiancaGeral > 0.5);

  // Especialização: os sinais medidos apontam para "trailer" entre os tipos do perfil FiveM.
  assert.equal(r.tiposDeConteudo.base, "estimado");
  assert.equal(r.tiposDeConteudo.valor?.[0].id, "trailer");
  // Qualquer referência funciona: em um perfil sem tipos definidos, o item não se aplica.
  const geral = await analisarReferencia(amostra("trailer"), { titulo: "Trailer", perfil: perfil("geral") });
  assert.equal(geral.tiposDeConteudo.base, "nao-aplicavel");
  assert.equal(geral.perfilDeEstilo["ritmo/cadencia-de-cortes"], "rapido");
});

test("distingue dissolução, fade para preto, zoom, panorâmica e barras de cinema", async () => {
  const dissolucao = await analisarReferencia(amostra("dissolucao"), { titulo: "Dissolução", perfil: perfil("geral") });
  assert.deepEqual(dissolucao.visual.transicoes.map((t) => t.tipo), ["gradual", "fade-preto"]);
  assert.ok(Math.abs(dissolucao.visual.transicoes[0].tempoSeg - 3.5) < 0.3);
  assert.equal(dissolucao.visual.planos.length, 2, "o fade final é encerramento, não troca de plano");
  assert.match(dissolucao.narrativa.encerramento.valor?.descricao ?? "", /fade para preto/);
  assert.equal(dissolucao.perfilDeEstilo["transicoes/encerramento"], "fade-preto");
  assert.equal(dissolucao.audio, null);
  assert.ok(dissolucao.limitacoes.some((l) => l.includes("não tem faixa de áudio")));

  const zoom = await analisarReferencia(amostra("zoom"), { titulo: "Zoom", perfil: perfil("geral") });
  assert.equal(zoom.visual.planos[0].movimento, "zoom-in");
  assert.equal(zoom.visual.movimentoDeCamera.base, "estimado");
  assert.equal(zoom.perfilDeEstilo["zoom/uso"], "frequente");

  const panoramica = await analisarReferencia(amostra("panoramica"), { titulo: "Panorâmica", perfil: perfil("geral") });
  assert.equal(panoramica.visual.planos[0].movimento, "panoramica");

  const barras = await analisarReferencia(amostra("barras"), { titulo: "Barras", perfil: perfil("geral") });
  assert.equal(barras.visual.planos[0].movimento, "estatico");
  assert.equal(barras.visual.composicao.valor?.barrasDeCinema, true);
  assert.equal(barras.perfilDeEstilo["efeitos-visuais/barras-de-cinema"], "sim");
  assert.equal(zoom.visual.composicao.valor?.barrasDeCinema, false);
});

test("sem provedor de IA: entrega o que foi medido e declara o que não pôde avaliar", async () => {
  const r = await analisarReferencia(amostra("trailer"), { titulo: "Trailer", perfil: perfil("redes-sociais") });
  for (const item of [r.visual.enquadramentos, r.visual.efeitos, r.visual.tipografia, r.visual.legendas, r.visual.animacoes]) {
    assert.equal(item.base, "nao-avaliado");
    assert.equal(item.valor, null);
  }
  for (const item of [r.narrativa.desenvolvimento, r.narrativa.suspense, r.narrativa.humor, r.narrativa.emocao]) assert.equal(item.base, "nao-avaliado");
  assert.equal(r.audio?.fala.base, "nao-avaliado");
  assert.equal(r.audio?.efeitosSonoros.base, "nao-avaliado");
  assert.equal(r.limitacoes.length, 3, "modelo visual, modelo de linguagem e Whisper");
  assert.deepEqual(r.modelosUsados, []);
  assert.ok(r.regras.every((regra) => regra.base === "observado" || regra.base === "estimado"));
  assert.deepEqual(r.visual.amostragem.quadrosChave, [], "sem modelo visual, nenhum quadro é extraído");
});

test("não força estrutura de redes sociais em formatos que não a pedem", async () => {
  const curto = await analisarReferencia(amostra("trailer"), { titulo: "T", perfil: perfil("redes-sociais") });
  assert.equal(curto.narrativa.estrutura, "curta");
  assert.equal(curto.narrativa.hook.base, "estimado");
  assert.equal(curto.narrativa.cta.base, "nao-avaliado");

  const documentario = await analisarReferencia(amostra("trailer"), { titulo: "T", perfil: perfil("documentario") });
  assert.equal(documentario.narrativa.estrutura, "livre");
  assert.equal(documentario.narrativa.hook.base, "nao-aplicavel");
  assert.equal(documentario.narrativa.cta.base, "nao-aplicavel");
  assert.equal(documentario.narrativa.progressao.base, "estimado", "o que não depende do formato continua sendo avaliado");
});

test("com provedores de IA: a leitura por modelo entra como estimada e não sobrepõe o que foi medido", async () => {
  const pedidos: { imagens?: string[]; sistema?: string } = {};
  const visao: ProvedorIA = {
    id: "olho-local", nome: "Modelo visual", origem: "local", capacidades: ["visao"], modelo: "visao-teste", disponivel: async () => true,
    descreverImagens: async (p: PedidoImagens) => {
      pedidos.imagens = p.imagens;
      return 'Claro! {"enquadramentos": "Planos abertos e médios", "efeitos": "Glitch nas trocas", "tipografia": "Fonte condensada em caixa alta", "legendas": "não observado", "animacoes": ""}';
    },
  };
  const linguagem: ProvedorIA = {
    id: "texto-local", nome: "Modelo de linguagem", origem: "local", capacidades: ["texto"], disponivel: async () => true,
    gerarTexto: async (p: PedidoTexto) => {
      pedidos.sistema = p.sistema;
      return JSON.stringify({
        narrativa: {
          hook: { presente: true, descricao: "Abre com a cena mais intensa", inicioSeg: 0 },
          suspense: { presente: true, descricao: "Pausa antes do último bloco", inicioSeg: 8 },
          humor: { presente: false, descricao: "Não há humor" },
        },
        regras: [
          { categoria: "hooks", chave: "abertura", valor: "impacto-imediato", descricao: "Começar pela cena mais forte", exemplo: "Usar o melhor plano nos 2 s iniciais" },
          { categoria: "ritmo", chave: "cadencia-de-cortes", valor: "lento", descricao: "Contradiz a medição", exemplo: "" },
          { categoria: "culinaria", chave: "x", valor: "y", descricao: "Categoria inválida", exemplo: "" },
        ],
      });
    },
  };
  const provedores = { selecionar: async (c: string) => (c === "visao" ? visao : linguagem) };
  const quadros = path.join(pasta, "quadros");
  const r = await analisarReferencia(amostra("trailer"), { titulo: "T", perfil: perfil("fivem"), provedores, pastaDeQuadros: quadros });

  assert.deepEqual([r.visual.enquadramentos.base, r.visual.enquadramentos.valor], ["estimado", "Planos abertos e médios"]);
  assert.match(r.visual.enquadramentos.metodo, /olho-local/);
  assert.equal(r.visual.animacoes.base, "nao-avaliado", "item que o modelo deixou em branco não é inventado");
  assert.equal(pedidos.imagens?.length, 8, "o modelo recebe 8 quadros-chave, não o vídeo inteiro");
  assert.ok(pedidos.imagens?.every((arquivo) => existsSync(arquivo)));

  assert.deepEqual([r.narrativa.suspense.base, r.narrativa.suspense.valor?.inicioSeg], ["estimado", 8]);
  assert.match(r.narrativa.humor.valor?.descricao ?? "", /^Ausente/);
  assert.equal(r.narrativa.hook.valor?.descricao, "Abre com a cena mais intensa");
  assert.match(pedidos.sistema ?? "", /vídeo curto de divulgação/);

  assert.equal(r.perfilDeEstilo["hooks/abertura"], "impacto-imediato");
  assert.equal(r.regras.find((x) => x.chave === "abertura")?.base, "estimado");
  assert.equal(r.perfilDeEstilo["ritmo/cadencia-de-cortes"], "rapido", "a regra medida prevalece sobre a sugerida pelo modelo");
  assert.ok(!r.regras.some((x) => (x.categoria as string) === "culinaria"));
  assert.equal(r.modelosUsados.length, 2);
  assert.equal(r.visual.ritmo.base, "observado");

  // Modelo que responde lixo: a análise continua e a falha vira limitação.
  const quebrado = { selecionar: async () => ({ ...linguagem, capacidades: ["texto", "visao"], gerarTexto: async () => "não sei", descreverImagens: async () => "???" }) as ProvedorIA };
  const comFalha = await analisarReferencia(amostra("barras"), { titulo: "T", perfil: perfil("geral"), provedores: quebrado, pastaDeQuadros: quadros });
  assert.equal(comFalha.visual.enquadramentos.base, "nao-avaliado");
  assert.equal(comFalha.limitacoes.filter((l) => l.includes("falhou")).length, 2);
});

test("integração com a memória: importa da pasta Referências, grava relatórios e só promove o que se repete", async () => {
  const base = mkdtempSync(path.join(pasta, "app-"));
  const caminhos = montarCaminhos(path.join(base, "dados"), path.join(base, "biblioteca"), RAIZ);
  mkdirSync(path.join(caminhos.referencias, "fivem"), { recursive: true });
  copyFileSync(amostra("trailer"), path.join(caminhos.referencias, "fivem", "trailer-a.mp4"));
  copyFileSync(amostra("dissolucao"), path.join(caminhos.referencias, "sem-perfil.mp4"));

  const app = new Aplicacao(caminhos);
  try {
    const importadas = app.referencias.importarPasta();
    assert.deepEqual(importadas.map((r) => [r.titulo, r.perfil]).sort(), [["sem-perfil", null], ["trailer-a", "fivem"]]);
    assert.equal(app.referencias.importarPasta().length, 0, "importar de novo não duplica");
    const a = importadas.find((r) => r.titulo === "trailer-a")!;

    const primeira = await app.referencias.analisar(a.id, { transcrever: false });
    assert.ok(existsSync(primeira.arquivoJson) && existsSync(primeira.arquivoMarkdown));
    assert.equal(JSON.parse(readFileSync(primeira.arquivoJson, "utf8")).versao, 1);
    const markdown = readFileSync(primeira.arquivoMarkdown, "utf8");
    for (const trecho of ["# Análise de referência: trailer-a", "observado", "estimado", "não avaliado", "## Regras de edição identificadas", "35 cortes/min"]) {
      assert.ok(markdown.includes(trecho), `relatório sem "${trecho}"`);
    }
    assert.equal(app.referencias.relatorio(a.id)?.perfil, "fivem");
    assert.equal(app.acervo.analises({ referenciaId: a.id }, "perfil-de-estilo").length, 1);

    // Uma referência sozinha só gera candidatos: nada é aplicado automaticamente.
    assert.ok(primeira.aprendizados.length >= 6);
    assert.ok(primeira.aprendizados.every((x) => x.estado === "candidato" && x.escopo === "especializacao" && x.perfil === "fivem"));
    const projeto = app.criarProjeto("Divulgação", "fivem");
    assert.equal(app.aprendizadosDoProjeto(projeto.id).aplicaveis.length, 0);
    assert.equal(app.aprendizado.evidencias(primeira.aprendizados[0].id)[0].referenciaId, a.id);

    // Analisar a mesma referência de novo não conta em dobro.
    const repetida = await app.referencias.analisar(a.id, { transcrever: false });
    assert.ok(repetida.aprendizados.every((x) => x.evidencias === 1 && x.estado === "candidato"));
    assert.equal(app.aprendizado.listar().length, primeira.aprendizados.length);

    // Uma segunda referência com o mesmo estilo confirma os princípios e eles passam a valer.
    copyFileSync(amostra("trailer"), path.join(caminhos.referencias, "fivem", "trailer-b.mp4"));
    const [b] = app.referencias.importarPasta();
    const segunda = await app.referencias.analisar(b.id, { transcrever: false });
    assert.ok(segunda.aprendizados.every((x) => x.estado === "ativo" && x.projetosObservados === 2));
    const aplicaveis = app.aprendizadosDoProjeto(projeto.id).aplicaveis;
    assert.equal(aplicaveis.find((x) => x.chave === "cadencia-de-cortes")?.valor, "rapido");
    assert.match(aplicaveis.find((x) => x.chave === "cadencia-de-cortes")?.contexto ?? "", /cortes/, "o exemplo de aplicação acompanha o aprendizado");

    // Referência sem perfil vai para o escopo geral, que exige ainda mais confirmações.
    const semPerfil = importadas.find((r) => r.titulo === "sem-perfil")!;
    const geral = await app.referencias.analisar(semPerfil.id, { transcrever: false });
    assert.ok(geral.aprendizados.every((x) => x.escopo === "geral" && x.estado === "candidato"));
    await assert.rejects(app.referencias.analisar(app.acervo.adicionarReferencia({ titulo: "Só link", origemUrl: "https://exemplo.com/v" }).id));
  } finally {
    app.encerrar();
  }
});

test("transcreve a fala com o Whisper e reconhece a chamada para ação", async (t) => {
  if (!temFala) return t.skip("FFmpeg sem o filtro flite: não foi possível gerar a amostra de fala");
  const base = mkdtempSync(path.join(pasta, "fala-"));
  const caminhos = montarCaminhos(path.join(base, "dados"), path.join(base, "biblioteca"), RAIZ);
  caminhos.modelos = path.join(RAIZ, "Dados", "modelos"); // reaproveita o modelo já baixado
  const app = new Aplicacao(caminhos);
  try {
    app.configuracoes.transcricao = { modelo: "tiny", idioma: "en" };
    const referencia = app.referencias.importar(amostra("fala"), { perfil: "fivem", autorizacao: "Amostra sintética" });
    const { relatorio } = await app.referencias.analisar(referencia.id);
    const fala = relatorio.audio?.fala;
    if (fala?.base !== "estimado") return t.skip(`Whisper indisponível neste ambiente: ${fala?.metodo}`);

    assert.match(fala.valor?.texto.toLowerCase() ?? "", /discord/);
    assert.ok((fala.valor?.tempoDeFalaSeg ?? 0) > 2);
    assert.equal(relatorio.narrativa.cta.base, "estimado");
    assert.match(relatorio.narrativa.cta.valor?.descricao ?? "", /discord/i);
    assert.equal(relatorio.perfilDeEstilo["narrativa/presenca-de-fala"], "predominante");
    assert.ok(relatorio.modelosUsados.includes("whisper: transcrição"));
    const uso = app.acervo.usosIA()[0];
    assert.deepEqual([uso.provedor, uso.modelo, uso.origem, uso.dispositivo, uso.sucesso], ["whisper-local", "tiny", "local", "cpu", true]);
  } finally {
    app.encerrar();
  }
});
