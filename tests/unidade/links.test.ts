// Referências por link: normalização, andamento, erros e download com um yt-dlp falso.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { baixarLink, classificarErro, lerAndamento, normalizarLink } from "../../Pipeline/ingestion/links.ts";

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
});

// yt-dlp falso: com -J responde metadados; sem ele, "baixa" dois arquivos (vídeo e áudio)
// imprimindo o andamento e o caminho final. O link escolhe o comportamento.
const YTDLP_FALSO = `#!/bin/sh
pasta=""; url=""; metadados=0
while [ $# -gt 0 ]; do
  case "$1" in
    -J) metadados=1 ;;
    --paths) shift; pasta="$1" ;;
    http*) url="$1" ;;
  esac
  shift
done
case "$url" in *login*) echo "ERROR: [Instagram] x: Requested content is not available, rate-limit reached or login required" >&2; exit 1 ;; esac
if [ $metadados = 1 ]; then
  echo '{"title":"Vídeo de teste","uploader":"Canal X","upload_date":"20260102","extractor_key":"Youtube","webpage_url":"'"$url"'","requested_formats":[{"format_id":"137"},{"format_id":"140"}]}'
  exit 0
fi
echo "IAEV 0 1000"; echo "IAEV 500 1000"
case "$url" in *queda*) echo "ERROR: Unable to download video data: timed out" >&2; exit 1 ;; esac
echo "IAEV 1000 1000"; echo "IAEV 0 200"; echo "IAEV 200 200"
mkdir -p "$pasta"; printf video > "$pasta/Video_de_teste [abc].mp4"
echo "$pasta/Video_de_teste [abc].mp4"
`;

function cenario() {
  const pasta = mkdtempSync(path.join(os.tmpdir(), "iaev-links-"));
  temporarias.push(pasta);
  const ytDlp = path.join(pasta, "yt-dlp");
  writeFileSync(ytDlp, YTDLP_FALSO, { mode: 0o755 });
  const destino = path.join(pasta, "Referencias");
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
