// Testes da preparação do vídeo: agentes de Arquivos, Conteúdo, Planejamento, Roteiro e
// Coordenador, com vídeos de resoluções, durações e formatos diferentes gerados pelo FFmpeg.
// Executar: npm test

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { AgenteDeConteudo } from "../../Pipeline/analysis/conteudo.ts";
import { AgenteDeRoteiro } from "../../Pipeline/editing/roteiro.ts";
import { AgenteDeArquivos } from "../../Pipeline/ingestion/arquivos.ts";
import type { PlanoDeEdicao } from "../../src/dominio/producao.ts";
import type { ProvedorIA } from "../../src/dominio/provedores.ts";
import { montarCaminhos } from "../../src/infra/caminhos.ts";
import { Aplicacao } from "../../src/nucleo/aplicacao.ts";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const base = mkdtempSync(path.join(os.tmpdir(), "iaev-producao-"));
const caminhos = montarCaminhos(path.join(base, "dados"), path.join(base, "biblioteca"), RAIZ);
caminhos.modelos = path.join(RAIZ, "Dados", "modelos"); // reaproveita o modelo do Whisper já baixado
const bruto = (nome: string) => path.join(caminhos.brutos, nome);
let temFala = false;
let app: Aplicacao;
let projetoId = "";

before(async () => {
  mkdirSync(caminhos.brutos, { recursive: true });
  const rodar = (argumentos: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...argumentos], { stdio: "pipe" });
  const h264 = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"];

  // 1080p, MP4, 10 s: 4 s parados e quase mudos, 4 s de ação com som alto, 2 s de tela preta.
  rodar([
    "-f", "lavfi", "-t", "4", "-i", "smptebars=s=1920x1080:r=30", "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=1:d=1",
    "-f", "lavfi", "-t", "2", "-i", "color=c=black:s=1920x1080:r=30", "-f", "lavfi", "-t", "4", "-i", "sine=f=220:r=44100",
    "-f", "lavfi", "-t", "4", "-i", "anoisesrc=c=pink:a=0.8:r=44100", "-f", "lavfi", "-t", "2", "-i", "anullsrc=r=44100:cl=mono",
    "-filter_complex",
    "[1:v]zoompan=z=1.5:x='320+300*sin(on/6)':y=40:d=120:s=1920x1080:fps=30,trim=end_frame=120,setpts=PTS-STARTPTS[acao];[0:v][acao][2:v]concat=n=3:v=1:a=0[v];" +
      "[3:a]volume=0.05[calmo];[calmo][4:a][5:a]concat=n=3:v=0:a=1[a]",
    "-map", "[v]", "-map", "[a]", ...h264, "-c:a", "aac", "-ac", "2", bruto("01-acao.mp4"),
  ]);
  // 360p, WebM (VP9), 24 quadros/s, 3 s, sem áudio.
  rodar(["-f", "lavfi", "-t", "3", "-i", "testsrc2=s=640x360:r=24", "-c:v", "libvpx-vp9", "-b:v", "300k", bruto("03-curto.webm")]);
  // MP4 truncado: não pode ser lido.
  writeFileSync(bruto("04-quebrado.mp4"), readFileSync(bruto("01-acao.mp4")).subarray(0, 30000));
  // 720p, MPEG-TS, com um trecho de bytes danificados no meio.
  rodar(["-f", "lavfi", "-t", "4", "-i", "testsrc2=s=1280x720:r=30", ...h264, "-f", "mpegts", bruto("05-defeito.ts")]);
  const danificado = readFileSync(bruto("05-defeito.ts"));
  for (let i = danificado.length >> 1; i < (danificado.length >> 1) + 40000; i += 1) danificado[i] = (danificado[i] * 7 + 13) % 256;
  writeFileSync(bruto("05-defeito.ts"), danificado);
  try {
    // 720×1280 vertical, MOV, 60 quadros/s: voz sintética sobre fundo liso. Depende do filtro flite.
    rodar([
      "-f", "lavfi", "-i", "flite=text='Welcome to the city. This is the best role play server. Join our discord today.':voice=slt",
      "-f", "lavfi", "-i", "color=c=0x203040:s=720x1280:r=60", ...h264, "-c:a", "aac", "-shortest", bruto("02-fala.mov"),
    ]);
    temFala = true;
  } catch {
    temFala = false;
  }

  app = new Aplicacao(caminhos);
  app.configuracoes.transcricao = { modelo: "tiny", idioma: "en" };
  projetoId = app.criarProjeto("Divulgação Cidade Alta", "fivem").id;
  app.producao.importarBrutos(projetoId);
  await app.producao.analisarBrutos(projetoId);
});

after(() => {
  app?.encerrar();
  rmSync(base, { recursive: true, force: true });
});

const analisado = (nome: string) => {
  const midia = app.projetos.midias(projetoId, "bruto").find((m) => m.caminho.endsWith(nome))!;
  return {
    midia,
    arquivo: app.acervo.analises({ midiaId: midia.id }, "arquivo")[0].resultado as Awaited<ReturnType<AgenteDeArquivos["examinar"]>>,
    conteudo: app.acervo.analises({ midiaId: midia.id }, "conteudo")[0]?.resultado as Awaited<ReturnType<AgenteDeConteudo["analisar"]>> | undefined,
  };
};

test("os cinco agentes existem, cada um com uma responsabilidade", () => {
  assert.deepEqual(app.producao.listarAgentes().map((a) => a.id), ["coordenador", "arquivos", "conteudo", "planejamento", "roteiro"]);
  assert.ok(app.producao.listarAgentes().every((a) => a.nome && a.responsabilidade));
});

test("Agente de Arquivos: dados técnicos, integridade e problemas em formatos e resoluções diferentes", () => {
  const acao = analisado("01-acao.mp4").arquivo;
  assert.deepEqual(
    [acao.nome, acao.formato, acao.tecnico?.largura, acao.tecnico?.altura, acao.tecnico?.fps, acao.tecnico?.codecVideo, acao.tecnico?.codecAudio, acao.audio?.canais, acao.integridade],
    ["01-acao.mp4", "mp4", 1920, 1080, 30, "h264", "aac", 2, "integro"],
  );
  assert.ok(Math.abs((acao.tecnico?.duracaoSeg ?? 0) - 10) < 0.2);
  assert.ok(acao.tamanhoBytes > 100_000 && acao.caminho === bruto("01-acao.mp4"));
  assert.deepEqual(acao.problemas.map((p) => p.codigo), ["orientacao-diferente"], "arquivo horizontal em projeto vertical");
  assert.equal(acao.verificacao, "decodificação completa do arquivo");

  const curto = analisado("03-curto.webm").arquivo;
  assert.deepEqual([curto.formato, curto.tecnico?.codecVideo, curto.tecnico?.fps, curto.tecnico?.temAudio, curto.audio], ["webm", "vp9", 24, false, null]);
  assert.ok(["sem-audio", "resolucao-baixa"].every((codigo) => curto.problemas.some((p) => p.codigo === codigo)));

  const quebrado = analisado("04-quebrado.mp4");
  assert.deepEqual([quebrado.arquivo.integridade, quebrado.arquivo.tecnico, quebrado.arquivo.tamanhoBytes], ["ilegivel", null, 30000]);
  assert.equal(quebrado.arquivo.problemas[0].gravidade, "erro");
  assert.equal(quebrado.conteudo, undefined, "arquivo ilegível não tem conteúdo analisado");

  const defeito = analisado("05-defeito.ts").arquivo;
  assert.deepEqual([defeito.integridade, defeito.tecnico?.altura], ["com-erros", 720]);
  assert.ok(defeito.problemas.some((p) => p.codigo === "erros-de-decodificacao" && p.gravidade === "erro"));

  if (temFala) {
    const fala = analisado("02-fala.mov").arquivo;
    assert.deepEqual([fala.formato, fala.tecnico?.orientacao, fala.tecnico?.largura, fala.tecnico?.fps], ["mov", "vertical", 720, 60]);
    assert.ok(!fala.problemas.some((p) => p.codigo === "orientacao-diferente"));
  }
});

test("Agente de Conteúdo: cenas, ação, silêncios, possíveis erros, destaques e miniaturas", () => {
  const { conteudo } = analisado("01-acao.mp4");
  assert.ok(conteudo);
  assert.deepEqual(conteudo.cenas.map((c) => [c.inicioSeg, c.fimSeg]), [[0, 4], [4, 8], [8, 10]]);
  assert.deepEqual(conteudo.momentosDeAcao.map((m) => [m.inicioSeg, m.fimSeg]), [[4, 8]]);
  assert.ok(conteudo.cenas[1].acao > 0.8 && conteudo.cenas[0].acao < 0.1);
  assert.deepEqual(conteudo.destaques, [1], "a cena de ação com som é o destaque");
  assert.ok(conteudo.cenas[1].pontuacao > 0.5 && conteudo.cenas[2].pontuacao === 0);
  assert.ok(conteudo.cenas[1].etiquetas.includes("acao") && conteudo.cenas[2].etiquetas.includes("tela-preta"));

  const erros = conteudo.possiveisErros.map((p) => p.codigo);
  assert.ok(["tela-preta", "imagem-parada", "silencio-longo"].every((codigo) => erros.includes(codigo)), erros.join(","));
  const preta = conteudo.possiveisErros.find((p) => p.codigo === "tela-preta")!;
  assert.deepEqual([preta.inicioSeg, preta.fimSeg], [8, 10]);
  assert.ok(conteudo.silencios.some((s) => s.inicioSeg >= 7.9));

  assert.ok(conteudo.cenas.every((c) => c.miniatura && existsSync(c.miniatura)));
  assert.ok(conteudo.cenas[0].miniatura?.includes(path.join("projetos", projetoId, "miniaturas")));
  assert.equal(conteudo.personagensEElementos.base, "nao-avaliado", "sem modelo visual, personagens não são supostos");
  assert.equal(conteudo.humor.base, "nao-avaliado");

  // Um plano longo é dividido em trechos de até 8 s, para o planejamento ter o que escolher.
  assert.ok(analisado("03-curto.webm").conteudo!.cenas.every((c) => c.duracaoSeg <= 8));
});

test("pesquisa por palavras ditas, acontecimentos e características", (t) => {
  // Arquivos distintos em que a consulta encontrou algum trecho.
  const arquivos = (consulta: string, filtros = {}) => [...new Set(app.producao.pesquisar(consulta, { projetoId, ...filtros }).map((r) => path.basename(r.arquivo)))];

  const acao = app.producao.pesquisar("ação", { projetoId, tipo: "acao" });
  assert.equal(path.basename(acao[0].arquivo), "01-acao.mp4", "o momento de ação mais intenso vem primeiro");
  assert.deepEqual([acao[0].inicioSeg, acao[0].fimSeg], [4, 8]);
  assert.deepEqual(arquivos("tela preta"), ["01-acao.mp4"]);
  assert.deepEqual(app.producao.pesquisar("tela-preta", { projetoId })[0].inicioSeg, 8);
  assert.deepEqual(arquivos("sem-audio", { tipo: "arquivo" }).sort(), ["03-curto.webm", "05-defeito.ts"]);
  assert.deepEqual(arquivos("webm"), ["03-curto.webm"]);
  assert.deepEqual(arquivos("1080p h264"), ["01-acao.mp4"], "todas as palavras precisam casar");
  assert.deepEqual(arquivos("ilegivel"), ["04-quebrado.mp4"]);
  assert.deepEqual(arquivos("erros-de-decodificacao"), ["05-defeito.ts"]);
  assert.deepEqual(arquivos("palavra-que-nao-existe"), []);
  assert.equal(app.producao.pesquisar("acao", { projetoId: "outro-projeto" }).length, 0);

  if (!temFala || !analisado("02-fala.mov").conteudo?.transcricao) return t.diagnostic("sem transcrição neste ambiente: pesquisa por fala não conferida");
  const fala = app.producao.pesquisar("discord", { projetoId, tipo: "fala" });
  assert.equal(path.basename(fala[0].arquivo), "02-fala.mov");
  assert.match(fala[0].texto.toLowerCase(), /discord/);
  assert.deepEqual(arquivos("vertical", { tipo: "arquivo" }), ["02-fala.mov"]);
});

test("Agente de Planejamento: plano com arquivos, intervalos, estrutura, áudio, legendas, trilha e CTA", () => {
  const briefing = {
    objetivo: "Divulgar a inauguração do servidor", publico: "Jogadores de roleplay", plataforma: "Instagram Reels",
    duracaoDesejadaSeg: 8, cta: "Entre no nosso Discord", fatos: ["Servidor Cidade Alta", "Inauguração no dia 20"],
  };
  const versao = app.producao.planejar(projetoId, briefing);
  const plano = versao.plano as PlanoDeEdicao;
  assert.deepEqual([versao.versao, versao.autor, versao.estado], [1, "ia", "rascunho"]);
  assert.deepEqual([plano.objetivo, plano.publico, plano.plataforma, plano.formato.id, plano.duracaoDesejadaSeg], [briefing.objetivo, briefing.publico, briefing.plataforma, "vertical-1080", 8]);

  // Cada clipe aponta um arquivo existente e um intervalo válido, fora dos trechos com defeito.
  assert.ok(plano.clipes.length >= 2);
  let tempo = 0;
  for (const clipe of plano.clipes) {
    const { arquivo, conteudo } = analisado(path.basename(clipe.arquivo));
    assert.ok(clipe.inicioOrigemSeg >= 0 && clipe.fimOrigemSeg <= (arquivo.tecnico?.duracaoSeg ?? 0) + 0.3 && clipe.fimOrigemSeg > clipe.inicioOrigemSeg, clipe.motivo);
    assert.ok(!conteudo!.possiveisErros.some((p) => p.codigo === "tela-preta" && p.inicioSeg! < clipe.fimOrigemSeg && clipe.inicioOrigemSeg < p.fimSeg!), "trecho de tela preta não entra no plano");
    assert.ok(Math.abs(clipe.inicioLinhaDoTempoSeg - tempo) < 0.02, "linha do tempo contínua");
    tempo += clipe.fimOrigemSeg - clipe.inicioOrigemSeg;
    assert.ok(clipe.motivo.length > 0);
  }
  assert.ok(!plano.clipes.some((c) => /04-quebrado|05-defeito/.test(c.arquivo)), "arquivos ilegíveis ou com erros não são usados");
  assert.ok(plano.avisos.some((a) => a.includes("05-defeito.ts") && a.includes("fora do plano")));
  assert.ok(Math.abs(plano.duracaoPlanejadaSeg - tempo) < 0.02);
  assert.ok(plano.duracaoPlanejadaSeg >= 4 && plano.duracaoPlanejadaSeg <= 14, `duração planejada ${plano.duracaoPlanejadaSeg}`);

  // Vídeo curto de divulgação: abre com o trecho mais forte (a cena de ação).
  assert.deepEqual([plano.clipes[0].bloco, path.basename(plano.clipes[0].arquivo), plano.clipes[0].transicaoDeEntrada], ["abertura", "01-acao.mp4", "nenhuma"]);
  assert.ok(plano.clipes[0].inicioOrigemSeg >= 4 && plano.clipes[0].fimOrigemSeg <= 8);
  assert.equal(plano.estruturaNarrativa[0].bloco, "abertura");
  assert.equal(plano.estruturaNarrativa.at(-1)?.bloco, "encerramento");
  assert.deepEqual(plano.transicoes, { padrao: "corte-seco", encerramento: "corte" });
  assert.deepEqual([plano.cta?.texto, plano.trilhaSonora.arquivo, plano.trilhaSonora.recomendada], ["Entre no nosso Discord", null, true]);
  assert.ok(plano.avisos.some((a) => a.includes("orientação diferente")));
  assert.ok(plano.decisoes.some((d) => d.origem === "briefing" && d.aspecto === "duracao"));
  assert.ok(plano.decisoes.some((d) => d.origem === "padrao"), "sem aprendizado, usa o padrão e diz isso");
  if (plano.legendas.ativas) {
    assert.equal(plano.audio.audioOriginal, "manter");
    assert.ok(plano.legendas.itens.every((i) => i.inicioSeg >= 0 && i.fimSeg <= plano.duracaoPlanejadaSeg + 0.1));
  }

  // Sem CTA informado, nenhum é inventado.
  const semCta = app.producao.planejar(projetoId, { objetivo: "Teste" }).plano as PlanoDeEdicao;
  assert.equal(semCta.cta, null);
  assert.ok(semCta.avisos.some((a) => a.includes("nada é inventado")));
  assert.equal(app.producao.briefing(projetoId)?.objetivo, "Teste");
});

test("o plano usa o que a memória aprendeu e diz de onde veio cada escolha", () => {
  const ritmo = app.aprendizado.observar({
    escopo: "especializacao", perfil: "fivem", categoria: "ritmo", chave: "cadencia-de-cortes", valor: "rapido",
    descricao: "Cortes rápidos", origem: "usuario",
  });
  app.aprendizado.observar({ escopo: "projeto", projetoId, categoria: "transicoes", chave: "encerramento", valor: "fade-preto", descricao: "Terminar em fade", origem: "usuario" });
  const plano = app.producao.planejar(projetoId, { objetivo: "Com aprendizados", duracaoDesejadaSeg: 8, cta: "Entre no Discord" }).plano as PlanoDeEdicao;

  const decisao = plano.decisoes.find((d) => d.aspecto === "ritmo/cadencia-de-cortes");
  assert.deepEqual([decisao?.origem, decisao?.decisao, decisao?.aprendizadoId], ["aprendizado", "rapido", ritmo.id]);
  assert.equal(plano.transicoes.encerramento, "fade-preto");
  const semFala = plano.clipes.filter((c) => !c.motivo.startsWith("fala"));
  assert.ok(semFala.every((c) => c.fimOrigemSeg - c.inicioOrigemSeg <= 1.75), "ritmo rápido: planos de até 1,7 s");
});

test("revisão e aprovação: alterações e decisões ficam na memória e a edição espera a aprovação", () => {
  assert.throws(() => app.producao.exigirPlanoAprovado(projetoId), /aprovado/);
  const atual = app.acervo.plano(projetoId);
  const alterado = structuredClone(atual.plano as PlanoDeEdicao);
  alterado.clipes.pop();

  const revisado = app.producao.revisarPlano(projetoId, alterado, "Removi o último trecho e pedi planos mais longos", [
    { categoria: "duracao-planos", chave: "duracao-tipica", valor: "media", descricao: "Planos um pouco mais longos" },
  ]);
  assert.deepEqual([revisado.versao, revisado.autor, revisado.estado], [atual.versao + 1, "usuario", "rascunho"]);
  assert.equal((app.acervo.plano(projetoId, atual.versao).plano as PlanoDeEdicao).clipes.length, alterado.clipes.length + 1, "a versão anterior continua intacta");
  // A correção vale para este projeto e fica como candidata no perfil.
  const doProjeto = app.aprendizadosDoProjeto(projetoId).aplicaveis.find((a) => a.chave === "duracao-tipica");
  assert.deepEqual([doProjeto?.escopo, doProjeto?.valor], ["projeto", "media"]);
  assert.equal(app.aprendizado.listar({ escopo: "especializacao", perfil: "fivem", categoria: "duracao-planos" })[0].estado, "candidato");

  const ritmo = app.aprendizado.listar({ categoria: "ritmo", perfil: "fivem" })[0];
  const aprovado = app.producao.aprovarPlano(projetoId);
  assert.deepEqual([aprovado.versao, aprovado.estado], [revisado.versao, "aprovado"]);
  assert.ok(aprovado.decididoEm);
  assert.equal(app.producao.exigirPlanoAprovado(projetoId).versao, revisado.versao);
  assert.equal(app.aprendizado.obter(ritmo.id).evidencias, ritmo.evidencias + 1, "aprovar confirma os aprendizados que o plano aplicou");

  // Uma versão nova depois da aprovação exige aprovar de novo.
  app.producao.revisarPlano(projetoId, alterado, "Outra mudança");
  assert.throws(() => app.producao.exigirPlanoAprovado(projetoId), /aprovado/);
  assert.equal(app.producao.rejeitarPlano(projetoId, "Ficou curto demais").estado, "rejeitado");

  assert.deepEqual(
    app.acervo.decisoes(projetoId).map((d) => d.tipo).filter((tipo) => tipo !== "plano-gerado"),
    ["alteracao", "aprovacao", "alteracao", "rejeicao"],
  );
  assert.ok(app.acervo.decisoes(projetoId).some((d) => d.descricao.includes("Ficou curto demais")));
});

test("Agente de Roteiro sem modelo: estrutura só com fatos do briefing e do material", async () => {
  app.producao.planejar(projetoId, { objetivo: "Divulgar a inauguração", cta: "Entre no nosso Discord", fatos: ["Servidor Cidade Alta", "Inauguração no dia 20"], duracaoDesejadaSeg: 8 });
  const roteiro = await app.producao.escreverRoteiro(projetoId);

  assert.equal(roteiro.base, "estrutura");
  assert.ok(roteiro.avisos.some((a) => a.includes("Nenhum modelo de linguagem")));
  assert.deepEqual(roteiro.angulos, ["gameplay", "humor", "imersão", "divulgação de funcionalidades", "eventos", "recrutamento"]);
  const conhecidos = new Set(roteiro.fatos.map((f) => f.id));
  assert.ok(roteiro.linhas.length > 0 && roteiro.linhas.every((l) => l.baseadoEm.length > 0 && l.baseadoEm.every((id) => conhecidos.has(id))), "toda linha cita um fato existente");
  const naTela = roteiro.linhas.filter((l) => l.tipo === "texto-na-tela").map((l) => l.texto);
  assert.deepEqual(naTela, ["Servidor Cidade Alta", "Inauguração no dia 20", "Entre no nosso Discord"].filter((texto) => naTela.includes(texto)), "cada fato aparece uma vez, sem repetição");
  assert.equal(naTela.at(-1), "Entre no nosso Discord");
  assert.deepEqual(naTela.filter((t) => t !== "Entre no nosso Discord").sort(), ["Inauguração no dia 20", "Servidor Cidade Alta"], "nenhum fato informado fica de fora");

  // Com um único trecho no plano, todos os fatos aparecem mesmo assim.
  const umaCena = { ...(app.acervo.plano(projetoId).plano as PlanoDeEdicao) };
  umaCena.clipes = umaCena.clipes.slice(0, 1);
  const curto = await new AgenteDeRoteiro().escrever({ projetoId, perfil: app.perfis.obter("fivem"), briefing: app.producao.briefing(projetoId)!, plano: umaCena });
  assert.deepEqual(curto.linhas.filter((l) => l.tipo === "texto-na-tela").map((l) => l.texto), ["Servidor Cidade Alta", "Inauguração no dia 20", "Entre no nosso Discord"]);
  assert.equal(roteiro.linhas[0].bloco, "abertura");
  assert.equal(app.producao.roteiro(projetoId)?.linhas.length, roteiro.linhas.length, "o roteiro fica guardado");
  assert.equal(app.acervo.decisoes(projetoId).at(-1)?.tipo, "roteiro");
});

test("Agente de Roteiro com modelo: uma linha por cena, na ordem do vídeo; descarta o que foi inventado, repetido ou genérico", async () => {
  const plano = app.acervo.plano(projetoId).plano as PlanoDeEdicao;
  const briefing = app.producao.briefing(projetoId)!;
  let sistema = "", pedidoEnviado = "";
  const responder = (resposta: unknown): { selecionar: () => Promise<ProvedorIA> } => ({
    selecionar: async () => ({
      id: "texto-local", nome: "Modelo", origem: "local", capacidades: ["texto"], disponivel: async () => true,
      gerarTexto: async (pedido) => { sistema = pedido.sistema ?? ""; pedidoEnviado = pedido.mensagem; return `Aqui está:\n${JSON.stringify(resposta)}`; },
    }),
  });
  const agente = new AgenteDeRoteiro();
  const entrada = { projetoId, perfil: app.perfis.obter("fivem"), briefing, plano };

  const n = plano.clipes.length;
  assert.ok(n >= 3, `o plano de teste tem cenas suficientes (${n})`);
  const cenas = [
    { n: 1, narracao: "Fala galera, neste vídeo vamos mostrar o servidor!", texto_na_tela: "", fatos: ["B1"] },
    { n: 2, narracao: "A Cidade Alta abre as portas no dia 20.", texto_na_tela: "Inauguração no dia 20", fatos: ["B1", "B2"] },
    // Repete a narração da cena 2 e inventa um número no texto da tela.
    { n: 3, narracao: "A Cidade Alta abre as portas no dia 20.", texto_na_tela: "300 carros exclusivos", fatos: ["B1"] },
    ...Array.from({ length: Math.max(0, n - 3) }, (_, k) => ({ n: k + 4, narracao: "Temos mais de 300 carros exclusivos.", texto_na_tela: "", fatos: [] })),
  ].filter((c) => n < 4 || c.n !== n); // com 4 cenas ou mais, o modelo "esquece" a última
  const roteiro = await agente.escrever({ ...entrada, provedores: responder({ ideia: "A cidade abre e convida o jogador", cenas }) });
  assert.equal(roteiro.base, "modelo");
  assert.equal(roteiro.ideia, "A cidade abre e convida o jogador");
  const textos = roteiro.linhas.map((l) => l.texto);
  assert.ok(!textos.some((t) => /300 carros|Fala galera/i.test(t)), textos.join(" | "));
  assert.equal(textos.filter((t) => t === "A Cidade Alta abre as portas no dia 20.").length, 1);
  assert.equal(roteiro.linhas[0].cena, 1, "o roteiro segue a ordem das cenas");
  assert.equal(roteiro.linhas[0].tipo, "imagem", "a abertura genérica vira o que aparece na primeira cena");
  const cenasEmOrdem = roteiro.linhas.filter((l) => !l.baseadoEm.includes("CTA")).map((l) => l.cena as number);
  assert.deepEqual(cenasEmOrdem, [...cenasEmOrdem].sort((a, b) => a - b), "linhas na ordem do vídeo");
  assert.deepEqual([...new Set(cenasEmOrdem)], Array.from({ length: n }, (_, k) => k + 1), "toda cena aparece, inclusive a que o modelo pulou");
  assert.ok(roteiro.linhas.every((l) => l.baseadoEm.includes("CTA") || (typeof l.inicioSeg === "number" && typeof l.fimSeg === "number")), "cada linha diz quando aparece");
  assert.ok(roteiro.linhas.some((l) => l.tipo === "texto-na-tela" && l.texto === "Inauguração no dia 20" && l.cena === 2));
  assert.equal(textos.at(-1), "Entre no nosso Discord", "o CTA é o informado pelo usuário, não o inventado pelo modelo");
  assert.ok(roteiro.avisos.some((a) => /trecho\(s\) do modelo foram descartados/.test(a)));
  assert.ok(roteiro.avisos.some((a) => a.includes("repetida")));
  assert.ok(roteiro.avisos.some((a) => a.includes("genérica")));
  if (n >= 4) assert.ok(roteiro.avisos.some((a) => /não escreveu 1 cena/.test(a)));
  assert.match(sistema, /não invente funcionalidades/);
  assert.match(sistema, /recrutamento/);
  assert.match(pedidoEnviado, new RegExp(`Cena ${n} — `), "o modelo recebe todas as cenas, na ordem");

  // Resposta inválida do modelo: volta a estrutura montada com os fatos.
  const invalido = await agente.escrever({ ...entrada, provedores: { selecionar: async () => ({ id: "x", nome: "x", origem: "local", capacidades: ["texto"], disponivel: async () => true, gerarTexto: async () => "não consigo" }) } });
  assert.equal(invalido.base, "estrutura");
  assert.ok(invalido.avisos.some((a) => a.includes("descartado")));
});

test("Agente de Conteúdo com modelos: elementos visuais e humor entram como estimados e ficam pesquisáveis", async (t) => {
  const agente = new AgenteDeConteudo();
  const arquivo = await new AgenteDeArquivos().examinar(bruto("01-acao.mp4"));
  const provedores = {
    selecionar: async (): Promise<ProvedorIA> => ({
      id: "olho-local", nome: "Modelo", origem: "local", capacidades: ["visao", "texto"], disponivel: async () => true,
      descreverImagens: async (pedido) => JSON.stringify({ quadros: pedido.imagens.map((_, i) => ({ n: i + 1, elementos: i === 1 ? ["viatura", "policial"] : ["barras coloridas"] })) }),
      gerarTexto: async () => '{"humor": [1]}',
    }),
  };
  const conteudo = await agente.analisar("m1", arquivo, { pastaDeMiniaturas: path.join(base, "mini"), provedores });
  assert.deepEqual(conteudo.cenas[1].elementos, ["viatura", "policial"]);
  assert.equal(conteudo.personagensEElementos.base, "estimado");
  assert.match(conteudo.personagensEElementos.metodo, /olho-local/);
  assert.ok(agente.indexar(arquivo, conteudo).some((e) => e.tipo === "cena" && e.texto.includes("viatura") && e.inicioSeg === 4));
  assert.equal(conteudo.humor.base, "nao-avaliado", "sem fala transcrita, o humor não é avaliado");

  if (!temFala) return t.diagnostic("sem amostra de fala: humor por modelo não conferido");
  const fala = await new AgenteDeArquivos().examinar(bruto("02-fala.mov"));
  const transcrever = async () => ({ idioma: "en", texto: "Join our discord today.", tempoDeFalaSeg: 2, segmentos: [{ inicioSeg: 1, fimSeg: 3, texto: "Join our discord today." }] });
  const comFala = await agente.analisar("m2", fala, { pastaDeMiniaturas: path.join(base, "mini2"), provedores, transcrever });
  assert.deepEqual([comFala.humor.base, comFala.humor.valor?.length], ["estimado", 1]);
  assert.ok(comFala.cenas[0].etiquetas.includes("humor") && comFala.cenas[0].etiquetas.includes("fala"));
  assert.ok(!comFala.cenas[0].etiquetas.includes("imagem-parada"), "imagem parada com fala não é tratada como defeito");
  assert.ok(comFala.cenas[0].pontuacao > 0.4);
});

test("tudo persiste: depois de fechar e reabrir, análises, índice, plano e decisões continuam lá", () => {
  app.encerrar();
  app = new Aplicacao(caminhos);
  assert.equal(app.projetos.midias(projetoId, "bruto").length, temFala ? 5 : 4);
  assert.equal(app.producao.importarBrutos(projetoId).length, 0, "importar de novo não duplica");
  assert.ok(app.producao.pesquisar("acao", { projetoId }).length > 0);
  assert.ok(app.acervo.historicoDePlanos(projetoId).length >= 5);
  assert.ok(app.acervo.decisoes(projetoId).length >= 8);
  assert.ok(app.producao.roteiro(projetoId));
  assert.equal(app.producao.briefing(projetoId)?.cta, "Entre no nosso Discord");
});
