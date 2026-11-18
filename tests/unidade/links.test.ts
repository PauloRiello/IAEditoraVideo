// Referências por link: normalização, andamento, erros e download com um yt-dlp falso.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { baixarLink, classificarErro, lerAndamento, normalizarLink } from "../../Pipeline/ingestion/links.ts";
import { montarCaminhos } from "../../src/infra/caminhos.ts";
import { iniciarServidor } from "../../src/interface/servidor.ts";
import { Aplicacao } from "../../src/nucleo/aplicacao.ts";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const temporarias: string[] = [];
after(() => {
  for (const pasta of temporarias) rmSync(pasta, { recursive: true, force: true });
});
const naoWindows = process.platform !== "win32";

test("normaliza links do YouTube, Instagram e TikTok", () => {
  const yt = { url: "https://www.youtube.com/watch?v=abc", site: "youtube" };
  assert.deepEqual(normalizarLink("https://youtu.be/abc?si=x"), yt);
  assert.deepEqual(normalizarLink("https://m.youtube.com/shorts/abc?feature=share"), yt);
  assert.deepEqual(normalizarLink("https://YouTube.com/watch?v=abc&t=42s&utm_source=x"), yt);
  assert.deepEqual(normalizarLink("https://www.instagram.com/reel/XyZ/?igsh=1"), { url: "https://www.instagram.com/reel/XyZ", site: "instagram" });
  assert.deepEqual(normalizarLink("https://www.tiktok.com/@a/video/123?lang=pt"), { url: "https://www.tiktok.com/@a/video/123", site: "tiktok" });
  assert.deepEqual(normalizarLink("  https://vimeo.com/42  "), { url: "https://vimeo.com/42", site: "outro" });
  // Formas que o Instagram e o TikTok usam ao compartilhar.
  assert.deepEqual(normalizarLink("https://www.instagram.com/fulano/reel/XyZ/?igsh=1"), { url: "https://www.instagram.com/reel/XyZ", site: "instagram" });
  assert.deepEqual(normalizarLink("https://www.instagram.com/reels/XyZ/"), { url: "https://www.instagram.com/reel/XyZ", site: "instagram" });
  assert.deepEqual(normalizarLink("https://www.tiktok.com/t/ZT8abc/"), { url: "https://www.tiktok.com/t/ZT8abc", site: "tiktok" });
  assert.deepEqual(normalizarLink("https://vm.tiktok.com/ZM1abc/"), { url: "https://vm.tiktok.com/ZM1abc", site: "tiktok" });
  assert.deepEqual(normalizarLink("https://www.youtube.com/embed/abc"), { url: "https://www.youtube.com/watch?v=abc", site: "youtube" });
});

test("recusa listas e perfis inteiros, e o que não é link", () => {
  for (const lista of ["https://www.youtube.com/playlist?list=PL1", "https://youtube.com/watch?list=PL1", "https://www.tiktok.com/@perfil", "https://www.instagram.com/perfil/"]) {
    assert.deepEqual(normalizarLink(lista), { erro: "lista" }, lista);
  }
  for (const invalido of ["ftp://x", "texto solto", ""]) assert.deepEqual(normalizarLink(invalido), { erro: "invalido" }, invalido);
});

test("lê o andamento do yt-dlp e classifica os erros", () => {
  assert.deepEqual(lerAndamento("IAEV 512 1024"), { baixados: 512, total: 1024 });
  assert.equal(lerAndamento("IAEV 10 NA"), null);
  assert.equal(lerAndamento("[download] 10%"), null);
  assert.equal(classificarErro("ERROR: [Instagram] x: Requested content is not available, rate-limit reached or login required"), "login");
  assert.equal(classificarErro("ERROR: Sign in to confirm you're not a bot. Use --cookies"), "login");
  assert.equal(classificarErro("ERROR: [youtube] x: Private video"), "indisponivel");
  assert.equal(classificarErro("ERROR: [youtube] x: Video unavailable"), "indisponivel");
  assert.equal(classificarErro("ERROR: Unsupported URL: https://exemplo.com"), "invalido");
  assert.equal(classificarErro("ERROR: Unable to download webpage: <urlopen error [Errno -3] getaddrinfo failed>"), "sem-conexao");
  assert.equal(classificarErro("ERROR: algo estranho"), "desconhecido");
  // Erro HTTP do site não é falta de internet, e aviso solto não decide nada.
  assert.equal(classificarErro("ERROR: Unable to download webpage: HTTP Error 404: Not Found"), "indisponivel");
  assert.equal(classificarErro("ERROR: Unable to download video data: HTTP Error 403: Forbidden"), "indisponivel");
  assert.equal(classificarErro("ERROR: [generic] x: Requested format is not available"), "desconhecido");
  assert.equal(classificarErro("WARNING: login required for some formats\nERROR: Unable to download webpage: <urlopen error timed out>"), "sem-conexao");
});

// yt-dlp falso: com -J responde metadados; sem ele, "baixa" dois arquivos (vídeo e áudio)
// imprimindo o andamento e o caminho final. O link escolhe o comportamento.
const YTDLP_FALSO = `#!/bin/sh
pasta=""; url=""; metadados=0; codificacao=""
while [ $# -gt 0 ]; do
  case "$1" in
    -J) metadados=1 ;;
    --encoding) shift; codificacao="$1" ;;
    --paths) shift; pasta="$1" ;;
    http*) url="$1" ;;
  esac
  shift
done
case "$url" in *login*) echo "ERROR: [Instagram] x: Requested content is not available, rate-limit reached or login required" >&2; exit 1 ;; esac
if [ $metadados = 1 ]; then
  canonica="$url"; case "$url" in *vm.tiktok.com*) canonica="https://www.tiktok.com/@a/video/999" ;; esac
  case "$url" in *naojson*) echo "aviso qualquer"; exit 0 ;; esac
  echo '{"title":"Vídeo de teste","uploader":"Canal X","upload_date":"20260102","extractor_key":"Youtube","webpage_url":"'"$canonica"'","requested_formats":[{"format_id":"137"},{"format_id":"140"}]}'
  exit 0
fi
echo baixou >> "$(dirname "$0")/chamadas"
echo "IAEV 0 1000"; echo "IAEV 500 1000"
case "$url" in *queda*) echo "ERROR: Unable to download video data: timed out" >&2; exit 1 ;; esac
echo "IAEV 1000 1000"; echo "IAEV 0 200"; echo "IAEV 200 200"
mkdir -p "$pasta"; printf video > "$pasta/Video_de_teste [abc].mp4"
# Como o Python no Windows: sem --encoding utf-8, a saída para outro programa sai em cp1252.
if [ "$codificacao" = "utf-8" ]; then echo "$pasta/Video_de_teste [abc].mp4"; else echo "$pasta/Video_de_teste [abc].mp4" | iconv -f utf-8 -t latin1; fi
`;

function cenario() {
  const pasta = mkdtempSync(path.join(os.tmpdir(), "iaev-links-"));
  temporarias.push(pasta);
  const ytDlp = path.join(pasta, "yt-dlp");
  writeFileSync(ytDlp, YTDLP_FALSO, { mode: 0o755 });
  const destino = path.join(pasta, "Referências"); // com acento, como a pasta real
  mkdirSync(destino);
  const eventos: [string, number][] = [];
  const opcoes = { pasta: destino, ytDlp, jsRuntime: process.execPath, configuracao: path.join(RAIZ, "config", "yt-dlp.conf"), aoAvancar: (etapa: string, fracao: number) => eventos.push([etapa, fracao]) };
  return { destino, eventos, opcoes };
}

test("baixa com porcentagem só avançando e devolve os metadados", { skip: !naoWindows }, async () => {
  const c = cenario();
  const r = await baixarLink("https://www.youtube.com/watch?v=abc", c.opcoes);
  assert.equal(r.arquivo, path.join(c.destino, "Video_de_teste [abc].mp4"));
  assert.equal(r.titulo, "Vídeo de teste");
  assert.equal(r.autor, "Canal X");
  assert.equal(r.data, "2026-01-02");
  assert.equal(r.site, "YouTube");
  const fracoes = c.eventos.map(([, f]) => f);
  for (let i = 1; i < fracoes.length; i++) assert.ok(fracoes[i] >= fracoes[i - 1], `voltou em "${c.eventos[i][0]}"`);
  assert.ok(fracoes.some((f) => f > 0.4 && f < 0.6), `meio do primeiro arquivo: ${fracoes.join(", ")}`);
  assert.ok(fracoes.at(-1)! >= 0.96);
});

test("login exigido vira a mensagem do Instagram", { skip: !naoWindows }, async () => {
  const c = cenario();
  await assert.rejects(baixarLink("https://www.instagram.com/reel/login", c.opcoes), (erro: Error & { codigo?: string }) => {
    assert.equal(erro.codigo, "login");
    assert.equal(erro.message, "O Instagram só deixa baixar esse vídeo com login. Salve o vídeo pelo celular ou pelo navegador e arraste o arquivo para cá.");
    return true;
  });
});

test("internet caiu no meio: erro sem-conexao e nenhum arquivo final", { skip: !naoWindows }, async () => {
  const c = cenario();
  await assert.rejects(baixarLink("https://www.youtube.com/watch?v=queda", c.opcoes), (erro: Error & { codigo?: string }) => erro.codigo === "sem-conexao" && /internet/i.test(erro.message));
  assert.deepEqual(readdirSync(c.destino).filter((a) => existsSync(path.join(c.destino, a)) && a.endsWith(".mp4")), []);
});

// ---------------------------------------------------------------------------
// Núcleo, rota e linha de comando (com o mesmo yt-dlp falso).

function aplicacaoDeTeste(comBaixador = true) {
  const c = cenario();
  const raiz = path.dirname(c.destino);
  // Pasta do programa própria, sem .venv: só o yt-dlp falso (quando pedido) baixa.
  const programa = path.join(raiz, "programa");
  mkdirSync(path.join(programa, "config"), { recursive: true });
  writeFileSync(path.join(programa, "config", "yt-dlp.conf"), "");
  for (const pasta of ["IA"]) mkdirSync(path.join(programa, pasta), { recursive: true });
  const caminhos = { ...montarCaminhos(path.join(raiz, "dados"), path.join(raiz, "bib"), RAIZ), ambiente: path.join(raiz, "ambiente") };
  const app = new Aplicacao(caminhos);
  if (comBaixador) app.referencias.ytDlp = c.opcoes.ytDlp;
  const chamadas = () => (existsSync(path.join(raiz, "chamadas")) ? readFileSync(path.join(raiz, "chamadas"), "utf8").trim().split("\n").length : 0);
  return { app, chamadas };
}

test("link já baixado em outra forma não baixa de novo", { skip: !naoWindows }, async () => {
  const { app, chamadas } = aplicacaoDeTeste();
  try {
    const primeira = await app.referencias.baixarDeLink("https://youtu.be/abc?si=1", {}, () => undefined);
    assert.equal(primeira.jaExistia, false);
    const segunda = await app.referencias.baixarDeLink("https://www.youtube.com/watch?v=abc&t=3", {}, () => undefined);
    assert.equal(segunda.jaExistia, true);
    assert.equal(segunda.referencia.id, primeira.referencia.id);
    assert.equal(chamadas(), 1);
  } finally {
    app.encerrar();
  }
});

test("a referência baixada guarda origem, autor, autorização e o vínculo com o projeto", { skip: !naoWindows }, async () => {
  const { app } = aplicacaoDeTeste();
  try {
    const projeto = app.criarProjeto("Com links", "geral");
    const { referencia } = await app.referencias.baixarDeLink("https://youtu.be/abc", { projetoId: projeto.id }, () => undefined);
    assert.equal(referencia.origemUrl, "https://www.youtube.com/watch?v=abc");
    assert.equal(referencia.titulo, "Vídeo de teste");
    assert.equal(referencia.notas, "Canal X · 2026-01-02 · YouTube");
    assert.match(referencia.autorizacao, /^Baixado de YouTube em \d{2}\/\d{2}\/\d{4} para análise como referência \(ensina princípio, não cópia\)\.$/);
    assert.ok(referencia.caminho?.startsWith(app.caminhos.referencias));
    assert.ok(app.acervo.referencias(projeto.id).some((r) => r.id === referencia.id));
  } finally {
    app.encerrar();
  }
});

test("sem yt-dlp no ambiente: mensagem para terminar a preparação", async () => {
  const { app } = aplicacaoDeTeste(false);
  try {
    app.referencias.ytDlp = path.join(app.caminhos.ambiente, "nao-existe", "yt-dlp");
    await assert.rejects(app.referencias.baixarDeLink("https://youtu.be/abc", {}, () => undefined), (erro: Error & { codigo?: string }) =>
      erro.codigo === "baixador-ausente" && erro.message === "O baixador de vídeos ainda não está instalado. Feche e abra o programa com internet para terminar a preparação.");
  } finally {
    app.encerrar();
  }
});

test("vários links, um inválido: os outros baixam e o inválido vira tarefa com erro", { skip: !naoWindows }, async () => {
  const { app } = aplicacaoDeTeste();
  const servidor = await iniciarServidor(app, {});
  try {
    const pedido = (rota: string, corpo?: unknown) => fetch(`http://127.0.0.1:${servidor.porta}${rota}`, {
      method: corpo ? "POST" : "GET", headers: { "x-iaev-sessao": servidor.token, "content-type": "application/json" }, body: corpo ? JSON.stringify(corpo) : undefined,
    }).then((r) => r.json());
    const r = await pedido("/api/referencias/links", { links: "https://youtu.be/abc\nnão é link\n\nhttps://www.instagram.com/reel/login\n" });
    assert.equal(r.tarefas.length, 3);
    let tarefas: { id: string; estado: string; erro: string | null; tipo: string }[] = [];
    for (let i = 0; i < 100; i++) {
      tarefas = (await pedido("/api/tarefas")).filter((t: { tipo: string }) => t.tipo === "download-de-referencia");
      if (tarefas.length === 3 && tarefas.every((t) => t.estado === "concluida" || t.estado === "falhou")) break;
      await new Promise((resolver) => setTimeout(resolver, 100));
    }
    const porId = new Map(tarefas.map((t) => [t.id, t]));
    const [ok, invalido, login] = r.tarefas.map((t: { id: string }) => porId.get(t.id));
    assert.equal(ok?.estado, "concluida");
    assert.equal(invalido?.estado, "falhou");
    assert.match(invalido?.erro ?? "", /não é de um vídeo/);
    assert.equal(login?.estado, "falhou");
    assert.match(login?.erro ?? "", /com login/);
    assert.equal(app.acervo.referencias().length, 1);
    assert.ok(app.atividades.listar().some((a) => a.descricao === 'Referência "Vídeo de teste" baixada de YouTube.'), "a atividade diz o site, não o link");
  } finally {
    await servidor.encerrar();
  }
});

test("caminho com acento (pasta Referências) chega inteiro, como no Windows", { skip: !naoWindows }, async () => {
  const c = cenario();
  const r = await baixarLink("https://www.youtube.com/watch?v=abc", c.opcoes);
  assert.equal(r.arquivo, path.join(c.destino, "Video_de_teste [abc].mp4"));
  assert.ok(existsSync(r.arquivo));
});

test("yt-dlp que não abre ou que responde algo estranho vira mensagem simples", { skip: !naoWindows }, async () => {
  const c = cenario();
  const semPermissao = path.join(path.dirname(c.destino), "sem-permissao");
  writeFileSync(semPermissao, "não executável", { mode: 0o644 });
  await assert.rejects(baixarLink("https://youtu.be/abc", { ...c.opcoes, ytDlp: semPermissao }), (erro: Error & { codigo?: string }) =>
    erro.codigo === "baixador-ausente" && /não pôde ser aberto/.test(erro.message));
  await assert.rejects(baixarLink("https://youtu.be/naojson", c.opcoes), (erro: Error & { codigo?: string }) => erro.codigo === "desconhecido" && !/JSON|Unexpected/.test(erro.message));
});

test("o mesmo vídeo por um link curto não é registrado de novo", { skip: !naoWindows }, async () => {
  const { app, chamadas } = aplicacaoDeTeste();
  try {
    const primeira = await app.referencias.baixarDeLink("https://www.tiktok.com/@a/video/999", {}, () => undefined);
    const segunda = await app.referencias.baixarDeLink("https://vm.tiktok.com/ZM1abc/", {}, () => undefined);
    assert.equal(segunda.jaExistia, true);
    assert.equal(segunda.referencia.id, primeira.referencia.id);
    assert.equal(chamadas(), 1);
    assert.equal(app.acervo.referencias().length, 1);
  } finally {
    app.encerrar();
  }
});

test("procurar novos arquivos ignora trilhas soltas e partes de download", () => {
  const { app } = aplicacaoDeTeste(false);
  try {
    mkdirSync(app.caminhos.referencias, { recursive: true });
    for (const nome of ["meio [abc].f137.mp4", "meio [abc].f251.webm", "meio [abc].mp4.part", "meio [abc].mp4.ytdl", "inteiro.mp4"]) writeFileSync(path.join(app.caminhos.referencias, nome), "x");
    assert.deepEqual(app.referencias.importarPasta().map((r) => r.titulo), ["inteiro"]);
  } finally {
    app.encerrar();
  }
});
