// Testes da IA local: download conferido, extração, liga e desliga sob demanda, reserva da
// placa de vídeo, troca para o processador e uso nas análises. O motor é simulado
// (tests/unidade/apoio/motor-simulado.mjs), servido por um servidor local com as somas de
// verificação, exatamente como o motor publicado seria baixado.
// Executar: npm test

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ErroAplicacao } from "../../src/dominio/erros.ts";
import { montarCaminhos } from "../../src/infra/caminhos.ts";
import { Aplicacao } from "../../src/nucleo/aplicacao.ts";
import { IALocal, imagemDeTeste, ProvedorIALocal, type ModeloLocal } from "../../src/servicos/ia-local.ts";
import { GerenciadorVram, type Hardware } from "../../src/servicos/recursos.ts";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const base = mkdtempSync(path.join(os.tmpdir(), "iaev-ia-local-"));
const caminhos = montarCaminhos(path.join(base, "dados"), path.join(base, "biblioteca"), RAIZ);
caminhos.temporarios = path.join(RAIZ, "Dados", "temp");
const registro = path.join(base, "motor.log");
process.env.IAEV_MOTOR_REGISTRO = registro;

const sha = (dados: Buffer) => createHash("sha256").update(dados).digest("hex");
const publicados = new Map<string, Buffer>();
const pedidosAoServidor: string[] = [];
const intervalosPedidos: string[] = [];
/** Arquivos cuja próxima entrega cai no meio: caminho → bytes entregues antes de cortar a conexão. */
const cortar = new Map<string, number>();
let servidor: http.Server;
let endereco = "";
let catalogo = "";
const configuracao = { ativa: true, modelo: null as string | null, desligarAposMin: 0.05 };
const comPlaca: Hardware = { plataforma: "teste", nucleos: 4, memoriaTotalMB: 16000, gpu: { fabricante: "nvidia", nome: "Placa de teste", vramMB: 6144 }, codificacaoPorHardware: false };

const linhas = () => (existsSync(registro) ? readFileSync(registro, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) : []);
const vivo = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

function novaIA(opcoes: { hardware?: Hardware; catalogoAlternativo?: string; vram?: GerenciadorVram } = {}) {
  const hardware = opcoes.hardware ?? comPlaca;
  const vram = opcoes.vram ?? new GerenciadorVram(hardware.gpu, 1024);
  const ia = new IALocal({
    caminhos, hardware, vram, configuracao: () => configuracao, pastaDoCatalogo: opcoes.catalogoAlternativo ?? catalogo, esperaParaLigarSeg: 20,
    origens: { motor: `${endereco}/motor/`, modelos: (m: ModeloLocal, arquivo: string) => `${endereco}/modelos/${m.id}/${arquivo}` },
  });
  return { ia, vram };
}

before(async () => {
  // Pacote do motor como o publicado: uma pasta com o programa llama-server dentro.
  const pacote = path.join(base, "pacote", "llama-b0");
  mkdirSync(pacote, { recursive: true });
  const executavel = path.join(pacote, process.platform === "win32" ? "llama-server.exe" : "llama-server");
  copyFileSync(path.join(RAIZ, "tests", "unidade", "apoio", "motor-simulado.mjs"), executavel);
  chmodSync(executavel, 0o755);
  const arquivoDoMotor = path.join(base, "motor.tar.gz");
  execFileSync("tar", ["-czf", arquivoDoMotor, "-C", path.join(base, "pacote"), "llama-b0"]);
  const motor = readFileSync(arquivoDoMotor);
  const modelo = Buffer.alloc(3 * 1024 * 1024, 7), visao = Buffer.alloc(1024 * 1024, 9);
  publicados.set("/motor/llama-teste.tar.gz", motor);
  publicados.set("/modelos/smolvlm-256m/modelo.gguf", modelo);
  publicados.set("/modelos/smolvlm-256m/visao.gguf", visao);

  // Catálogo de teste: mesma estrutura de IA/Local, com os arquivos acima.
  catalogo = path.join(base, "catalogo");
  mkdirSync(catalogo, { recursive: true });
  const reais = JSON.parse(readFileSync(path.join(RAIZ, "IA", "Local", "modelos.json"), "utf8")) as { modelos: ModeloLocal[] };
  const teste = reais.modelos.find((m) => m.id === "smolvlm-256m") as ModeloLocal;
  writeFileSync(path.join(catalogo, "motor.json"), JSON.stringify({
    nome: "motor de teste", versao: "b0", licenca: "MIT", origem: "", endereco: "",
    variantes: ["gpu", "cpu"].map((aceleracao) => ({ id: `teste-${aceleracao}`, plataforma: process.platform, arquitetura: process.arch, aceleracao, descricao: `teste ${aceleracao}`, arquivo: "llama-teste.tar.gz", tamanho: motor.length, sha256: sha(motor) })),
  }));
  writeFileSync(path.join(catalogo, "modelos.json"), JSON.stringify({ modelos: [
    ...reais.modelos.filter((m) => !m.somenteTeste),
    { ...teste, modelo: { arquivo: "modelo.gguf", tamanho: modelo.length, sha256: sha(modelo) }, visao: { arquivo: "visao.gguf", tamanho: visao.length, sha256: sha(visao) }, vramMB: 2000 },
  ] }));

  servidor = http.createServer((pedido, resposta) => {
    pedidosAoServidor.push(pedido.url ?? "");
    const dados = publicados.get(pedido.url ?? "");
    if (!dados) { resposta.writeHead(404); resposta.end(); return; }
    const intervalo = /^bytes=(\d+)-$/.exec(String(pedido.headers.range ?? ""));
    if (intervalo) intervalosPedidos.push(`${pedido.url} ${pedido.headers.range}`);
    const inicio = intervalo ? Number(intervalo[1]) : 0;
    const parte = dados.subarray(inicio);
    resposta.writeHead(intervalo ? 206 : 200, { "content-length": parte.length, ...(intervalo ? { "content-range": `bytes ${inicio}-${dados.length - 1}/${dados.length}` } : {}) });
    const corte = cortar.get(pedido.url ?? "");
    if (corte !== undefined) {
      cortar.delete(pedido.url ?? "");
      resposta.write(parte.subarray(0, corte), () => setTimeout(() => resposta.destroy(), 50)); // a conexão cai no meio
      return;
    }
    resposta.end(parte);
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", () => r()));
  endereco = `http://127.0.0.1:${(servidor.address() as { port: number }).port}`;
});

after(() => {
  servidor?.close();
  for (const linha of linhas()) if (linha.evento === "iniciado" && vivo(linha.pid as number)) process.kill(linha.pid as number);
  rmSync(base, { recursive: true, force: true });
});

test("recomenda o modelo pelo computador: placa de 6 GB fica com o 4B; sem placa e pouca memória, o 2B", () => {
  const programa = { caminhos, vram: new GerenciadorVram(null, 1024), configuracao: () => configuracao };
  assert.equal(new IALocal({ ...programa, hardware: comPlaca }).recomendado().id, "qwen3-vl-4b");
  assert.equal(new IALocal({ ...programa, hardware: { ...comPlaca, gpu: null, memoriaTotalMB: 8000 } }).recomendado().id, "qwen3-vl-2b");
  assert.equal(new IALocal({ ...programa, hardware: { ...comPlaca, gpu: null, memoriaTotalMB: 32000 } }).recomendado().id, "qwen3-vl-4b");
  const estado = new IALocal({ ...programa, hardware: comPlaca }).estado();
  assert.deepEqual([estado.instalada, estado.ligada, estado.modelos.map((m) => m.id)], [false, false, ["qwen3-vl-4b", "qwen3-vl-2b"]], "o modelo de teste não é oferecido");
  // O catálogo publicado tem licença, origem e soma de verificação para cada arquivo.
  for (const m of JSON.parse(readFileSync(path.join(RAIZ, "IA", "Local", "modelos.json"), "utf8")).modelos as ModeloLocal[]) {
    assert.match(m.licenca, /Apache-2\.0/);
    for (const parte of [m.modelo, m.visao]) assert.match(parte.sha256, /^[a-f0-9]{64}$/);
  }
});

test("instalação: baixa conferindo a soma de verificação, desempacota e não baixa de novo o que já está certo", async () => {
  const { ia } = novaIA();
  const etapas: [string, number | null][] = [];
  const estado = await ia.instalar("smolvlm-256m", (etapa, fracao) => etapas.push([etapa, fracao]));
  assert.deepEqual([estado.instalada, estado.modelo?.id, estado.motor?.variante], [true, "smolvlm-256m", "teste-gpu"], "com placa, a versão do motor para placa");
  assert.ok(etapas.some(([e]) => /Baixando o motor/.test(e)) && etapas.some(([e]) => /Baixando o modelo/.test(e)));
  const fracoes = etapas.map(([, f]) => f).filter((f): f is number => f !== null);
  assert.ok(fracoes.every((f, i) => i === 0 || f >= fracoes[i - 1]) && fracoes.at(-1) === 1, "o progresso só avança e termina em 100%");
  assert.ok(existsSync(path.join(caminhos.modelos, "ia-local", "smolvlm-256m", "modelo.gguf")));
  assert.ok(!existsSync(path.join(caminhos.dados, "ia-local", "downloads", "llama-teste.tar.gz")), "o pacote baixado é apagado depois de desempacotado");

  const antes = pedidosAoServidor.length;
  await ia.instalar("smolvlm-256m");
  assert.equal(pedidosAoServidor.length, antes, "repetir a instalação não baixa nada");
});

test("download interrompido continua de onde parou, e o progresso mostra quanto já foi baixado", async () => {
  const caminho = path.join(caminhos.modelos, "ia-local", "smolvlm-256m", "modelo.gguf");
  rmSync(caminho);
  cortar.set("/modelos/smolvlm-256m/modelo.gguf", 1024 * 1024);
  const { ia } = novaIA();
  await assert.rejects(ia.instalar("smolvlm-256m"), (e: unknown) => e instanceof ErroAplicacao && e.codigo === "download-falhou" && /continua de onde parou/.test(e.message));
  assert.equal(readFileSync(`${caminho}.parcial`).length, 1024 * 1024, "a parte baixada fica guardada");

  const etapas: [string, number][] = [];
  await ia.instalar("smolvlm-256m", (etapa, fracao) => etapas.push([etapa, fracao]));
  assert.ok(intervalosPedidos.includes("/modelos/smolvlm-256m/modelo.gguf bytes=1048576-"), "pede só o que falta");
  assert.ok(readFileSync(caminho).equals(publicados.get("/modelos/smolvlm-256m/modelo.gguf") as Buffer), "o arquivo final é idêntico ao publicado");
  assert.ok(!existsSync(`${caminho}.parcial`));
  const doModelo = etapas.filter(([e]) => /Baixando o modelo/.test(e));
  assert.match(doModelo[0][0], /: 1 MB de 3 MB$/, "começa mostrando o que já tinha sido baixado");
  assert.match(doModelo.at(-1)?.[0] ?? "", /: 3 MB de 3 MB$/);
  assert.ok(etapas.every(([, f]) => typeof f === "number" && f >= 0 && f <= 1), "toda etapa tem porcentagem");
});

test("arquivo diferente do publicado é descartado, e com um arquivo faltando a IA local não se dá por instalada", async () => {
  const original = publicados.get("/modelos/smolvlm-256m/visao.gguf") as Buffer;
  rmSync(path.join(caminhos.modelos, "ia-local", "smolvlm-256m", "visao.gguf"));
  publicados.set("/modelos/smolvlm-256m/visao.gguf", Buffer.concat([original.subarray(0, original.length - 1), Buffer.from([0])]));
  const { ia } = novaIA();
  await assert.rejects(ia.instalar("smolvlm-256m"), (e: unknown) => e instanceof ErroAplicacao && e.codigo === "download-corrompido" && /descartado/.test(e.message));
  assert.ok(!existsSync(path.join(caminhos.modelos, "ia-local", "smolvlm-256m", "visao.gguf")) && !existsSync(path.join(caminhos.modelos, "ia-local", "smolvlm-256m", "visao.gguf.parcial")));
  assert.equal(ia.estado().instalada, false, "com um arquivo faltando, a IA local não se dá por instalada");
  publicados.set("/modelos/smolvlm-256m/visao.gguf", original);
  assert.equal((await ia.instalar("smolvlm-256m")).instalada, true);
});

test("liga só quando precisa, na placa de vídeo, responde em JSON, reaproveita o motor e desliga sozinha", async () => {
  const { ia, vram } = novaIA();
  const provedor = new ProvedorIALocal(ia);
  assert.equal(await provedor.disponivel(), true);
  assert.equal(linhas().filter((l) => l.evento === "iniciado").length, 0, "estar disponível não liga o motor");
  const livreAntes = vram.livreMB;

  const texto = await provedor.gerarTexto({ mensagem: "Teste" });
  assert.deepEqual(JSON.parse(texto), { humor: [1], resposta: "5" });
  const iniciados = linhas().filter((l) => l.evento === "iniciado");
  assert.equal(iniciados.length, 1);
  const argumentos = iniciados[0].argumentos as string[];
  assert.equal(argumentos[argumentos.indexOf("-ngl") + 1], "99", "o modelo vai para a placa de vídeo");
  assert.equal(argumentos[argumentos.indexOf("--host") + 1], "127.0.0.1", "o motor só atende este computador");
  assert.deepEqual([ia.estado().ligada, ia.estado().dispositivo, vram.livreMB], [true, "gpu", livreAntes - 2000], "a memória da placa fica reservada enquanto ligada");

  const imagem = path.join(base, "teste.png");
  writeFileSync(imagem, imagemDeTeste());
  const resposta = JSON.parse(await provedor.descreverImagens({ instrucao: "Descreva", imagens: [imagem, imagem] })) as { quadros: unknown[] };
  assert.equal(resposta.quadros.length, 2);
  assert.equal(linhas().filter((l) => l.evento === "iniciado").length, 1, "o segundo pedido usa o motor já ligado");
  const pedidos = linhas().filter((l) => l.evento === "pedido");
  assert.ok(pedidos.every((p) => p.formato === "json_object"), "a resposta é pedida em JSON");
  assert.deepEqual([pedidos.at(-1)?.imagens, pedidos.at(-1)?.imagemValida], [2, true], "as imagens vão embutidas, como o llama-server espera");

  for (let i = 0; i < 60 && ia.estado().ligada; i += 1) await esperar(200);
  assert.equal(ia.estado().ligada, false, "desliga sozinha depois do tempo sem uso");
  assert.equal(vram.livreMB, livreAntes, "e devolve a memória da placa");
  assert.ok(!vivo(iniciados[0].pid as number), "o processo do motor terminou");
});

test("se a placa de vídeo falhar, o motor é ligado de novo pelo processador; sem espaço na placa, vai direto ao processador", async () => {
  process.env.IAEV_MOTOR_FALHA_NA_PLACA = "1";
  const { ia } = novaIA();
  await ia.usar((p) => p.gerarTexto({ mensagem: "Teste" }));
  const iniciados = linhas().filter((l) => l.evento === "iniciado").slice(-2).map((l) => (l.argumentos as string[])[(l.argumentos as string[]).indexOf("-ngl") + 1]);
  assert.deepEqual(iniciados, ["99", "0"]);
  assert.equal(ia.estado().dispositivo, "cpu");
  await ia.parar();
  delete process.env.IAEV_MOTOR_FALHA_NA_PLACA;

  const vram = new GerenciadorVram(comPlaca.gpu, 1024);
  vram.reservar("whisper-medium", 4500); // o Whisper ocupa a placa
  const ocupada = novaIA({ vram }).ia;
  await ocupada.usar((p) => p.gerarTexto({ mensagem: "Teste" }));
  const ultimo = linhas().filter((l) => l.evento === "iniciado").at(-1)?.argumentos as string[];
  assert.equal(ultimo[ultimo.indexOf("-ngl") + 1], "0");
  await ocupada.parar();
  assert.equal(vram.livreMB, 6144 - 1024 - 4500, "a reserva do Whisper continua intacta");
});

test("desativada nas configurações, a IA local não é usada; o teste completo confere que ela enxerga", async () => {
  const { ia } = novaIA();
  configuracao.ativa = false;
  assert.equal(await new ProvedorIALocal(ia).disponivel(), false);
  configuracao.ativa = true;
  const r = await ia.testar();
  assert.deepEqual([r.enxergou, r.dispositivo], [true, "gpu"]);
  assert.match(r.texto, /resposta/);
  await ia.parar();
});

test("na aplicação: a análise dos vídeos brutos usa a IA local para identificar os elementos das cenas", async () => {
  // A instalação feita acima vale para a aplicação, que lê o catálogo publicado (o modelo de teste está nele).
  mkdirSync(caminhos.brutos, { recursive: true });
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-t", "2", "-i", "testsrc2=s=640x360:r=30", "-f", "lavfi", "-t", "2", "-i", "smptebars=s=640x360:r=30",
    "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", path.join(caminhos.brutos, "material.mp4")]);
  const app = new Aplicacao(caminhos);
  try {
    assert.equal(app.iaLocal.estado().instalada, true);
    assert.ok((await app.provedores.situacao()).some((p) => p.id === "ia-local" && p.disponivel && p.origem === "local" && p.permitido), "a IA local entra como provedor local, sem precisar autorizar serviços externos");
    const projeto = app.criarProjeto("Com IA local", "fivem");
    app.producao.importarBrutos(projeto.id);
    const [analisado] = await app.producao.analisarBrutos(projeto.id, { transcrever: false });
    const conteudo = analisado.conteudo!;
    assert.ok(!conteudo.limitacoes.some((l) => /nenhum modelo visual/.test(l)), conteudo.limitacoes.join(" | "));
    assert.deepEqual(conteudo.personagensEElementos.valor, ["carro", "pessoa"]);
    assert.equal(conteudo.personagensEElementos.base, "estimado", "interpretação de modelo é sempre marcada como estimativa");
    assert.match(conteudo.personagensEElementos.metodo, /ia-local/);
    assert.ok(app.iaLocal.estado().ligada, "ligou para a análise");
  } finally {
    await app.iaLocal.parar();
    app.encerrar();
  }
  assert.ok(linhas().filter((l) => l.evento === "iniciado").every((l) => !vivo(l.pid as number)), "nenhum motor fica rodando depois de fechar a aplicação");
});
