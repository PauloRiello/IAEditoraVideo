// Servidor local da interface gráfica. Atende só ao próprio computador (127.0.0.1), exige a
// sessão criada pelo inicializador e não depende de nenhum serviço externo. A interface é
// uma página servida daqui; toda a lógica continua na classe Aplicacao.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { ErroAplicacao, NaoEncontrado } from "../dominio/erros.ts";
import type { Aplicacao } from "../nucleo/aplicacao.ts";
import { ROTAS, type Rota } from "./rotas.ts";

const PASTA_WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), "web");
const COOKIE = "iaev_sessao";
const PORTA_PADRAO = 47810;
const LIMITE_DO_CORPO = 2 * 1024 * 1024;
const EVENTOS = ["tarefa:atualizada", "render:atualizado", "render:progresso", "atividade"];
const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon", ".md": "text/markdown; charset=utf-8",
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".ogg": "audio/ogg", ".flac": "audio/flac",
};

export interface Contexto {
  app: Aplicacao;
  /** Parâmetros do caminho, por exemplo o `:id` de /api/projetos/:id. */
  p: Record<string, string>;
  consulta: URLSearchParams;
  /** Corpo JSON do pedido (objeto vazio quando não há). */
  corpo: Record<string, unknown>;
  req: IncomingMessage;
  res: ServerResponse;
  servidor: ServidorDaInterface;
}

export interface OpcoesDoServidor {
  porta?: number;
  /** Segredo da sessão. Por padrão, sorteado a cada inicialização. */
  token?: string;
  /** Encerra a aplicação quando a janela fica fechada e não há trabalho em andamento. */
  encerrarSemJanela?: boolean;
  esperaSemJanelaSeg?: number;
  /** Chamado depois que a aplicação foi encerrada pela interface ou por falta de janela. */
  aoEncerrar?: () => void;
}

export interface ServidorDaInterface {
  porta: number;
  token: string;
  /** Endereço que abre a interface já com a sessão. */
  url: string;
  /** Encerra com calma: interrompe renders, fecha o banco e para de atender. */
  encerrar(): Promise<void>;
  /** Pede o encerramento depois de responder ao pedido em curso. */
  pedirEncerramento(): void;
}

/** Erro de pedido inválido, com o código HTTP a devolver. */
export class ErroDePedido extends Error {
  estado: number;
  constructor(estado: number, mensagem: string) {
    super(mensagem);
    this.estado = estado;
  }
}

const iguais = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function json(res: ServerResponse, estado: number, dados: unknown): void {
  const corpo = JSON.stringify(dados ?? null);
  res.writeHead(estado, { "content-type": TIPOS[".json"], "cache-control": "no-store", "content-length": Buffer.byteLength(corpo) });
  res.end(corpo);
}

async function lerCorpo(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!String(req.headers["content-type"] ?? "").includes("application/json")) return {};
  const partes: Buffer[] = [];
  let tamanho = 0;
  for await (const parte of req) {
    tamanho += (parte as Buffer).length;
    if (tamanho > LIMITE_DO_CORPO) throw new ErroDePedido(413, "Pedido grande demais.");
    partes.push(parte as Buffer);
  }
  if (tamanho === 0) return {};
  try {
    const dados = JSON.parse(Buffer.concat(partes).toString("utf8")) as unknown;
    return dados && typeof dados === "object" && !Array.isArray(dados) ? (dados as Record<string, unknown>) : {};
  } catch {
    throw new ErroDePedido(400, "O pedido não está em JSON válido.");
  }
}

/** Envia um arquivo, atendendo a pedidos parciais (necessários para avançar e voltar em vídeos). */
export function enviarArquivo(req: IncomingMessage, res: ServerResponse, arquivo: string, nomeParaBaixar?: string): void {
  if (!existsSync(arquivo) || !statSync(arquivo).isFile()) throw new ErroDePedido(404, "O arquivo não está mais no disco.");
  const tamanho = statSync(arquivo).size;
  const cabecalhos: Record<string, string | number> = {
    "content-type": TIPOS[path.extname(arquivo).toLowerCase()] ?? "application/octet-stream", "accept-ranges": "bytes", "cache-control": "no-store",
    ...(nomeParaBaixar ? { "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(nomeParaBaixar)}` } : {}),
  };
  const faixa = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
  if (faixa && (faixa[1] || faixa[2]) && tamanho > 0) {
    const inicio = faixa[1] ? Number(faixa[1]) : Math.max(0, tamanho - Number(faixa[2]));
    const fim = faixa[1] && faixa[2] ? Math.min(Number(faixa[2]), tamanho - 1) : tamanho - 1;
    if (inicio > fim || inicio >= tamanho) {
      res.writeHead(416, { "content-range": `bytes */${tamanho}` });
      res.end();
      return;
    }
    res.writeHead(206, { ...cabecalhos, "content-range": `bytes ${inicio}-${fim}/${tamanho}`, "content-length": fim - inicio + 1 });
    if (req.method === "HEAD") res.end();
    else createReadStream(arquivo, { start: inicio, end: fim }).pipe(res);
    return;
  }
  res.writeHead(200, { ...cabecalhos, "content-length": tamanho });
  if (req.method === "HEAD") res.end();
  else createReadStream(arquivo).pipe(res);
}

/**
 * Grava em disco um arquivo enviado pela interface. O envio vai para um arquivo parcial e
 * só recebe o nome final ao terminar; um arquivo existente nunca é sobrescrito.
 */
export async function receberArquivo(req: IncomingMessage, pasta: string, nome: string, extensoes: Set<string>): Promise<string> {
  const limpo = path.basename(nome).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  const extensao = path.extname(limpo).toLowerCase();
  if (!limpo || !extensoes.has(extensao)) throw new ErroDePedido(415, `Tipo de arquivo não aceito (${extensao || "sem extensão"}). Aceitos: ${[...extensoes].join(", ")}.`);
  mkdirSync(pasta, { recursive: true });
  let destino = path.join(pasta, limpo);
  for (let n = 2; existsSync(destino) || existsSync(`${destino}.parcial`); n += 1) destino = path.join(pasta, `${path.basename(limpo, path.extname(limpo))} (${n})${path.extname(limpo)}`);
  const parcial = `${destino}.parcial`;
  try {
    await pipeline(req, createWriteStream(parcial));
    if (statSync(parcial).size === 0) throw new ErroDePedido(400, "O arquivo enviado está vazio.");
    renameSync(parcial, destino);
  } catch (erro) {
    rmSync(parcial, { force: true });
    throw erro;
  }
  return destino;
}

interface RotaCompilada { rota: Rota; partes: string[] }

function casar(rotas: RotaCompilada[], metodo: string, caminho: string): { rota: Rota; p: Record<string, string> } | null {
  const partes = caminho.split("/").filter(Boolean);
  for (const { rota, partes: molde } of rotas) {
    if (rota.metodo !== metodo || molde.length !== partes.length) continue;
    const p: Record<string, string> = {};
    let serve = true;
    for (let i = 0; i < molde.length && serve; i += 1) {
      if (molde[i].startsWith(":")) {
        try {
          p[molde[i].slice(1)] = decodeURIComponent(partes[i]);
        } catch {
          serve = false;
        }
      } else if (molde[i] !== partes[i]) serve = false;
    }
    if (serve) return { rota, p };
  }
  return null;
}

/** Inicia o servidor da interface. Tenta a porta padrão e as seguintes; em último caso, qualquer porta livre. */
export async function iniciarServidor(app: Aplicacao, opcoes: OpcoesDoServidor = {}): Promise<ServidorDaInterface> {
  const token = opcoes.token ?? randomBytes(24).toString("hex");
  const rotas: RotaCompilada[] = ROTAS.map((rota) => ({ rota, partes: rota.caminho.split("/").filter(Boolean) }));
  const janelas = new Set<ServerResponse>();
  let encerrando: Promise<void> | null = null;
  let vigia: NodeJS.Timeout | null = null;
  let porta = 0;

  const autorizado = (req: IncomingMessage): boolean => {
    const cookie = new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]+)`).exec(String(req.headers.cookie ?? ""))?.[1];
    const cabecalho = String(req.headers["x-iaev-sessao"] ?? "");
    return (cookie !== undefined && iguais(cookie, token)) || (cabecalho !== "" && iguais(cabecalho, token));
  };

  // Só o próprio computador é atendido, e só por este endereço: páginas de outros sites não conseguem usar a aplicação.
  const origemValida = (req: IncomingMessage): boolean => {
    const anfitrioes = new Set([`127.0.0.1:${porta}`, `localhost:${porta}`]);
    if (!anfitrioes.has(String(req.headers.host ?? ""))) return false;
    const origem = req.headers.origin;
    return !origem || [...anfitrioes].some((a) => origem === `http://${a}`);
  };

  const semJanela = (): void => {
    if (!opcoes.encerrarSemJanela || encerrando) return;
    if (vigia) clearTimeout(vigia);
    vigia = setTimeout(() => {
      if (janelas.size > 0) return;
      if (app.tarefas.emAndamento().length > 0) semJanela(); // há trabalho em andamento: espera terminar
      else void servidor.encerrar();
    }, (opcoes.esperaSemJanelaSeg ?? 90) * 1000);
    vigia.unref();
  };

  const eventos = (req: IncomingMessage, res: ServerResponse): void => {
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" });
    res.write("retry: 2000\n\n");
    janelas.add(res);
    if (vigia) clearTimeout(vigia);
    const pulso = setInterval(() => res.write(": pulso\n\n"), 20_000);
    req.on("close", () => {
      clearInterval(pulso);
      janelas.delete(res);
      if (janelas.size === 0) semJanela();
    });
  };
  const transmitir = (nome: string) => (dados: unknown) => {
    for (const janela of janelas) janela.write(`event: ${nome}\ndata: ${JSON.stringify(dados)}\n\n`);
  };
  const ouvintes = EVENTOS.map((nome) => [nome, transmitir(nome)] as const);
  for (const [nome, ouvinte] of ouvintes) app.eventos.on(nome, ouvinte);

  const estatico = (req: IncomingMessage, res: ServerResponse, caminho: string): void => {
    const relativo = caminho === "/" ? "index.html" : caminho.slice(1);
    const arquivo = path.resolve(PASTA_WEB, relativo);
    if (!arquivo.startsWith(PASTA_WEB + path.sep) || !existsSync(arquivo) || !statSync(arquivo).isFile()) throw new ErroDePedido(404, "Página não encontrada.");
    res.setHeader("content-security-policy", "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader("x-content-type-options", "nosniff");
    enviarArquivo(req, res, arquivo);
  };

  const atender = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const metodo = req.method ?? "GET";
    if (!origemValida(req)) throw new ErroDePedido(403, "Pedido recusado: endereço de origem não permitido.");
    if (metodo === "GET" && url.pathname === "/api/saude") return json(res, 200, { ok: true, aplicacao: "ia-editora-video" });

    // A sessão começa quando o inicializador abre a página com o segredo; daí em diante vale o cookie.
    const segredo = url.searchParams.get("t");
    if (metodo === "GET" && url.pathname === "/" && segredo && iguais(segredo, token)) {
      res.setHeader("set-cookie", `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`);
      return estatico(req, res, "/");
    }
    if (!autorizado(req)) {
      if (url.pathname.startsWith("/api/")) throw new ErroDePedido(401, "Sessão não reconhecida. Abra a IA Editora de Vídeo pelo atalho ou pelo inicializador.");
      res.writeHead(401, { "content-type": TIPOS[".html"] });
      res.end("<!doctype html><meta charset=\"utf-8\"><title>IA Editora de Vídeo</title><body style=\"font-family:sans-serif;background:#14161a;color:#e8eaed;padding:3rem\"><h1>IA Editora de Vídeo</h1><p>Abra a aplicação pelo atalho ou pelo inicializador (Iniciar). Este endereço só funciona a partir dele.</p>");
      return;
    }

    if (!url.pathname.startsWith("/api/")) {
      if (metodo !== "GET" && metodo !== "HEAD") throw new ErroDePedido(405, "Método não permitido.");
      return estatico(req, res, url.pathname);
    }
    if (metodo === "GET" && url.pathname === "/api/eventos") return eventos(req, res);

    const achada = casar(rotas, metodo, url.pathname);
    if (!achada) throw new ErroDePedido(404, "Operação desconhecida.");
    const corpo = achada.rota.envio ? {} : await lerCorpo(req);
    const resultado = await achada.rota.atender({ app, p: achada.p, consulta: url.searchParams, corpo, req, res, servidor });
    if (!res.headersSent) json(res, 200, resultado === undefined ? { ok: true } : resultado);
  };

  const http_ = http.createServer((req, res) => {
    atender(req, res).catch((erro: unknown) => {
      if (res.headersSent) { res.destroy(); return; }
      if (erro instanceof ErroDePedido) return json(res, erro.estado, { erro: { codigo: "pedido-invalido", mensagem: erro.message } });
      if (erro instanceof NaoEncontrado) return json(res, 404, { erro: { codigo: erro.codigo, mensagem: erro.message } });
      if (erro instanceof ErroAplicacao) return json(res, 422, { erro: { codigo: erro.codigo, mensagem: erro.message } });
      // Erro inesperado: a mensagem vai para a interface, sem pilha de execução.
      json(res, 500, { erro: { codigo: "erro-interno", mensagem: erro instanceof Error ? erro.message : String(erro) } });
    });
  });

  const escutar = (tentativa: number): Promise<number> =>
    new Promise((resolver, rejeitar) => {
      const pedida = opcoes.porta ?? PORTA_PADRAO;
      const alvo = pedida === 0 || tentativa >= 20 ? 0 : pedida + tentativa;
      http_.once("error", (erro: NodeJS.ErrnoException) => {
        if (erro.code === "EADDRINUSE" && alvo !== 0) resolver(escutar(tentativa + 1));
        else rejeitar(erro);
      });
      http_.listen(alvo, "127.0.0.1", () => {
        http_.removeAllListeners("error");
        resolver((http_.address() as { port: number }).port);
      });
    });

  const servidor: ServidorDaInterface = {
    porta: 0, token, url: "",
    encerrar(): Promise<void> {
      encerrando ??= (async () => {
        if (vigia) clearTimeout(vigia);
        for (const [nome, ouvinte] of ouvintes) app.eventos.off(nome, ouvinte);
        try {
          await app.edicao.cancelarTudo();
        } catch {
          // segue encerrando mesmo que um render não pare com calma
        }
        app.encerrar();
        for (const janela of janelas) janela.end("event: encerrada\ndata: {}\n\n");
        await new Promise<void>((resolver) => {
          http_.close(() => resolver());
          http_.closeAllConnections();
        });
        opcoes.aoEncerrar?.();
      })();
      return encerrando;
    },
    pedirEncerramento(): void {
      setTimeout(() => void servidor.encerrar(), 150);
    },
  };
  porta = await escutar(0);
  servidor.porta = porta;
  servidor.url = `http://127.0.0.1:${porta}/?t=${token}`;
  if (opcoes.encerrarSemJanela) {
    // Se nenhuma janela se conectar (o navegador não abriu), a aplicação não fica rodando para sempre.
    vigia = setTimeout(() => { if (janelas.size === 0 && app.tarefas.emAndamento().length === 0) void servidor.encerrar(); }, 5 * 60_000);
    vigia.unref();
  }
  return servidor;
}
