// IA local: um modelo aberto de visão e linguagem que roda neste computador, sem internet
// nem serviço pago. A aplicação baixa o motor (llama.cpp) e o modelo uma vez, conferindo
// cada arquivo pela soma SHA-256 publicada; liga o motor só quando uma análise precisa e o
// desliga sozinho depois de alguns minutos parado, para devolver a memória.
// O motor e o modelo ficam na pasta de dados: sobrevivem a atualizações do programa.

import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import { deflateSync } from "node:zlib";
import { ErroAplicacao } from "../dominio/erros.ts";
import type { Capacidade, PedidoImagens, PedidoTexto, ProvedorIA } from "../dominio/provedores.ts";
import type { Caminhos } from "../infra/caminhos.ts";
import { ProvedorCompativelOpenAI } from "./provedores.ts";
import type { GerenciadorVram, Hardware } from "./recursos.ts";

export interface ArquivoBaixavel { arquivo: string; tamanho: number; sha256: string }

export interface VarianteDoMotor extends ArquivoBaixavel {
  id: string;
  plataforma: string;
  arquitetura: string;
  aceleracao: "gpu" | "cpu";
  descricao: string;
}

export interface CatalogoDoMotor { nome: string; versao: string; licenca: string; origem: string; endereco: string; variantes: VarianteDoMotor[] }

export interface ModeloLocal {
  id: string;
  nome: string;
  descricao: string;
  licenca: string;
  origem: string;
  repositorio: string;
  revisao: string;
  modelo: ArquivoBaixavel;
  /** Projetor de imagens: o que permite ao modelo "ver". */
  visao: ArquivoBaixavel;
  /** Memória da placa de vídeo necessária para rodar inteiro nela. */
  vramMB: number;
  memoriaMinimaMB: number;
  contexto: number;
  /** Lento demais só no processador: só é recomendado com placa de vídeo. */
  exigePlaca?: boolean;
  somenteTeste?: boolean;
}

interface Instalacao {
  motor: { versao: string; variante: string; aceleracao: "gpu" | "cpu"; executavel: string };
  modelo: { id: string; arquivo: string; visao: string };
  instaladoEm: string;
}

export interface EstadoDaIALocal {
  /** Motor e modelo baixados e conferidos. */
  instalada: boolean;
  /** Configuração do usuário: usar a IA local quando instalada. */
  ativa: boolean;
  /** O motor está rodando agora. */
  ligada: boolean;
  /** Onde o modelo roda enquanto está ligado. */
  dispositivo: "gpu" | "cpu" | null;
  motor: { versao: string; variante: string; descricao: string } | null;
  modelo: { id: string; nome: string; licenca: string } | null;
  /** Modelo recomendado para este computador. */
  recomendado: string;
  modelos: (Pick<ModeloLocal, "id" | "nome" | "descricao" | "licenca" | "origem"> & { tamanhoMB: number; adequado: boolean })[];
  /** Último problema ao ligar ou usar o motor, se houver. */
  erro: string | null;
}

export interface OpcoesDaIALocal {
  caminhos: Caminhos;
  hardware: Hardware;
  vram: GerenciadorVram;
  /** Configuração atual (lida a cada uso, para refletir mudanças feitas na janela). */
  configuracao: () => { ativa: boolean; modelo: string | null; desligarAposMin: number };
  /** Pasta com motor.json e modelos.json. Padrão: IA/Local do programa. */
  pastaDoCatalogo?: string;
  /** Endereços alternativos para baixar (testes). */
  origens?: { motor?: string; modelos?: (modelo: ModeloLocal, arquivo: string) => string };
  /** Quanto esperar o motor ficar pronto (carregar o modelo pode demorar). */
  esperaParaLigarSeg?: number;
}

/** Etapa em andamento e fração já feita do total (0 a 1). */
export type AoProgredir = (etapa: string, fracao: number) => void;

const MB = 1024 * 1024;
const EXECUTAVEL = process.platform === "win32" ? "llama-server.exe" : "llama-server";

/** Porta livre neste computador. */
function portaLivre(): Promise<number> {
  return new Promise((resolver, rejeitar) => {
    const sonda = createServer();
    sonda.once("error", rejeitar);
    sonda.listen(0, "127.0.0.1", () => {
      const { port } = sonda.address() as { port: number };
      sonda.close(() => resolver(port));
    });
  });
}

function procurar(pasta: string, nome: string): string | null {
  for (const item of readdirSync(pasta, { withFileTypes: true })) {
    const caminho = path.join(pasta, item.name);
    if (item.isFile() && item.name === nome) return caminho;
    if (item.isDirectory()) {
      const achado = procurar(caminho, nome);
      if (achado) return achado;
    }
  }
  return null;
}

/** Tamanho legível: "850 MB" ou "2,5 GB". */
export const tamanhoLegivel = (bytes: number): string => (bytes >= 1024 * MB ? `${(bytes / (1024 * MB)).toFixed(1).replace(".", ",")} GB` : `${Math.round(bytes / MB)} MB`);

/**
 * Baixa um arquivo conferindo tamanho e SHA-256. Só recebe o nome final se estiver íntegro.
 * Se um download anterior parou no meio, continua de onde parou (quando o servidor permite).
 * `aoProgredir` recebe os bytes já baixados, com avisos limitados a alguns por segundo.
 */
async function baixar(url: string, destino: string, esperado: ArquivoBaixavel, aoProgredir: (bytes: number) => void, sinal?: AbortSignal): Promise<void> {
  if (existsSync(destino) && statSync(destino).size === esperado.tamanho) { aoProgredir(esperado.tamanho); return; } // já baixado e conferido antes
  mkdirSync(path.dirname(destino), { recursive: true });
  const parcial = `${destino}.parcial`;
  let jaTem = existsSync(parcial) ? statSync(parcial).size : 0;
  if (jaTem >= esperado.tamanho) { rmSync(parcial, { force: true }); jaTem = 0; }
  let resposta: Response;
  try {
    resposta = await fetch(url, { signal: sinal, redirect: "follow", headers: jaTem ? { range: `bytes=${jaTem}-` } : {} });
  } catch (erro) {
    if (sinal?.aborted) throw new ErroAplicacao("cancelado", "Instalação cancelada. O que já foi baixado fica guardado para continuar depois.");
    throw new ErroAplicacao("sem-conexao", `Não foi possível baixar ${esperado.arquivo}: sem conexão com ${new URL(url).host} (${erro instanceof Error ? erro.message : erro}). O que já foi baixado fica guardado para continuar depois.`);
  }
  if (jaTem && resposta.status !== 206) jaTem = 0; // o servidor não continua downloads: recomeça
  if (!resposta.ok || !resposta.body) throw new ErroAplicacao("download-falhou", `Não foi possível baixar ${esperado.arquivo}: o servidor respondeu ${resposta.status}.`);
  // A soma de verificação cobre o arquivo inteiro: a parte já baixada entra na conta primeiro.
  const hash = createHash("sha256");
  if (jaTem) for await (const pedaco of createReadStream(parcial) as AsyncIterable<Buffer>) hash.update(pedaco);
  let recebidos = jaTem;
  let ultimoAviso = 0;
  aoProgredir(recebidos);
  const saida = createWriteStream(parcial, { flags: jaTem ? "a" : "w" });
  try {
    for await (const pedaco of Readable.fromWeb(resposta.body as never) as AsyncIterable<Buffer>) {
      hash.update(pedaco);
      recebidos += pedaco.length;
      if (!saida.write(pedaco)) await new Promise<void>((r) => saida.once("drain", () => r()));
      if (Date.now() - ultimoAviso >= 250) { ultimoAviso = Date.now(); aoProgredir(Math.min(recebidos, esperado.tamanho)); }
    }
    await new Promise<void>((resolver, rejeitar) => saida.end((erro?: Error | null) => (erro ? rejeitar(erro) : resolver())));
  } catch (erro) {
    saida.destroy();
    // A parte baixada fica guardada: a próxima tentativa continua dela.
    if (sinal?.aborted) throw new ErroAplicacao("cancelado", "Instalação cancelada. O que já foi baixado fica guardado para continuar depois.");
    throw new ErroAplicacao("download-falhou", `O download de ${esperado.arquivo} foi interrompido em ${tamanhoLegivel(recebidos)} de ${tamanhoLegivel(esperado.tamanho)} (${erro instanceof Error ? erro.message : erro}). Tente de novo: ele continua de onde parou.`);
  }
  aoProgredir(Math.min(recebidos, esperado.tamanho));
  const soma = hash.digest("hex");
  if (recebidos !== esperado.tamanho || soma !== esperado.sha256) {
    rmSync(parcial, { force: true });
    throw new ErroAplicacao("download-corrompido", `O arquivo ${esperado.arquivo} chegou diferente do publicado (tamanho ou soma de verificação não conferem) e foi descartado. Tente de novo.`);
  }
  renameSync(parcial, destino);
}

/** Desempacota com o tar do sistema (no Windows 10 e 11 ele também abre .zip). */
function desempacotar(arquivo: string, pasta: string): Promise<void> {
  mkdirSync(pasta, { recursive: true });
  return new Promise((resolver, rejeitar) => {
    // No Windows, o tar do próprio sistema (abre .zip); outro tar no caminho de busca, como o do Git, pode não abrir.
    const doWindows = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    const tar = process.platform === "win32" && existsSync(doWindows) ? doWindows : "tar";
    const processo = spawn(tar, ["-xf", arquivo, "-C", pasta], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let erro = "";
    processo.stderr.on("data", (bloco: Buffer) => (erro += bloco.toString()));
    processo.on("error", (falha) => rejeitar(new ErroAplicacao("desempacotar", `Não foi possível desempacotar o motor de IA: ${falha.message}`)));
    processo.on("close", (codigo) => (codigo === 0 ? resolver() : rejeitar(new ErroAplicacao("desempacotar", `Não foi possível desempacotar o motor de IA: ${erro.trim().slice(-300)}`))));
  });
}

/** Imagem PNG simples (fundo branco com um quadrado vermelho), para conferir se o modelo enxerga. */
export function imagemDeTeste(lado = 128): Buffer {
  const linha = 1 + lado * 3;
  const bruto = Buffer.alloc(linha * lado, 255);
  for (let y = 0; y < lado; y += 1) {
    bruto[y * linha] = 0;
    for (let x = 0; x < lado; x += 1) {
      if (x > lado * 0.2 && x < lado * 0.8 && y > lado * 0.2 && y < lado * 0.8) bruto.set([220, 20, 20], y * linha + 1 + x * 3);
    }
  }
  const tabela = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (dados: Buffer) => {
    let c = 0xffffffff;
    for (const byte of dados) c = tabela[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const bloco = (tipo: string, dados: Buffer) => {
    const tamanho = Buffer.alloc(4);
    tamanho.writeUInt32BE(dados.length);
    const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
    const soma = Buffer.alloc(4);
    soma.writeUInt32BE(crc(corpo));
    return Buffer.concat([tamanho, corpo, soma]);
  };
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(lado, 0);
  cabecalho.writeUInt32BE(lado, 4);
  cabecalho.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco("IHDR", cabecalho), bloco("IDAT", deflateSync(bruto)), bloco("IEND", Buffer.alloc(0))]);
}

export class IALocal {
  private o: OpcoesDaIALocal;
  private processo: ChildProcess | null = null;
  private porta = 0;
  private ligando: Promise<number> | null = null;
  private dispositivo: "gpu" | "cpu" | null = null;
  private relogio: NodeJS.Timeout | null = null;
  private emUso = 0;
  private ultimoErro: string | null = null;
  private registro = "";
  private instalando: AbortController | null = null;

  constructor(opcoes: OpcoesDaIALocal) {
    this.o = opcoes;
  }

  private get base(): string {
    return path.join(this.o.caminhos.dados, "ia-local");
  }

  private get arquivoDaInstalacao(): string {
    return path.join(this.base, "instalacao.json");
  }

  private catalogo(): { motor: CatalogoDoMotor; modelos: ModeloLocal[] } {
    const pasta = this.o.pastaDoCatalogo ?? path.join(this.o.caminhos.programa, "IA", "Local");
    return {
      motor: JSON.parse(readFileSync(path.join(pasta, "motor.json"), "utf8")) as CatalogoDoMotor,
      modelos: (JSON.parse(readFileSync(path.join(pasta, "modelos.json"), "utf8")) as { modelos: ModeloLocal[] }).modelos,
    };
  }

  private instalacao(): Instalacao | null {
    try {
      const dados = JSON.parse(readFileSync(this.arquivoDaInstalacao, "utf8")) as Instalacao;
      const pastaDoModelo = path.join(this.o.caminhos.modelos, "ia-local", dados.modelo.id);
      const presentes = [dados.motor.executavel, path.join(pastaDoModelo, dados.modelo.arquivo), path.join(pastaDoModelo, dados.modelo.visao)].every((arquivo) => existsSync(arquivo));
      return presentes ? dados : null;
    } catch {
      return null;
    }
  }

  /** O modelo cabe neste computador? Placa com memória suficiente, ou memória do sistema suficiente para rodar pelo processador. */
  private adequado(modelo: ModeloLocal): boolean {
    const vram = this.o.hardware.gpu?.vramMB ?? 0;
    if (modelo.exigePlaca && !this.o.hardware.gpu) return false;
    // Com placa: memória da placa e do sistema suficientes. Sem placa: o dobro de memória do sistema.
    return (vram >= modelo.vramMB && this.o.hardware.memoriaTotalMB >= modelo.memoriaMinimaMB) || this.o.hardware.memoriaTotalMB >= modelo.memoriaMinimaMB * 2;
  }

  /** Modelo recomendado: o maior que cabe neste computador (o de teste nunca é recomendado). */
  recomendado(): ModeloLocal {
    const reais = this.catalogo().modelos.filter((m) => !m.somenteTeste);
    return reais.find((m) => this.adequado(m)) ?? reais[reais.length - 1];
  }

  private variante(): VarianteDoMotor {
    const { motor } = this.catalogo();
    const daPlataforma = motor.variantes.filter((v) => v.plataforma === process.platform && v.arquitetura === process.arch);
    if (daPlataforma.length === 0) throw new ErroAplicacao("plataforma-sem-motor", `A IA local não tem motor para este sistema (${process.platform}-${process.arch}).`);
    // Com placa de vídeo, a versão para placa; ela também roda pelo processador se a placa falhar.
    const querGpu = Boolean(this.o.hardware.gpu);
    return daPlataforma.find((v) => (v.aceleracao === "gpu") === querGpu) ?? daPlataforma[0];
  }

  estado(): EstadoDaIALocal {
    const { motor, modelos } = this.catalogo();
    const instalada = this.instalacao();
    const modelo = instalada ? modelos.find((m) => m.id === instalada.modelo.id) : undefined;
    return {
      instalada: instalada !== null,
      ativa: this.o.configuracao().ativa,
      ligada: this.processo !== null && this.porta > 0,
      dispositivo: this.processo ? this.dispositivo : null,
      motor: instalada ? { versao: instalada.motor.versao, variante: instalada.motor.variante, descricao: motor.variantes.find((v) => v.id === instalada.motor.variante)?.descricao ?? "" } : null,
      modelo: instalada ? { id: instalada.modelo.id, nome: modelo?.nome ?? instalada.modelo.id, licenca: modelo?.licenca ?? "" } : null,
      recomendado: this.recomendado().id,
      modelos: modelos.filter((m) => !m.somenteTeste).map((m) => ({
        id: m.id, nome: m.nome, descricao: m.descricao, licenca: m.licenca, origem: m.origem, tamanhoMB: Math.round((m.modelo.tamanho + m.visao.tamanho) / MB), adequado: this.adequado(m),
      })),
      erro: this.ultimoErro,
    };
  }

  /** Baixa (se preciso), confere e prepara o motor e o modelo. Pode ser repetido: o que já está certo não é baixado de novo. */
  async instalar(idDoModelo: string | null, aoProgredir: AoProgredir = () => undefined): Promise<EstadoDaIALocal> {
    if (this.instalando) throw new ErroAplicacao("ocupada", "A IA local já está sendo instalada.");
    const { motor, modelos } = this.catalogo();
    const modelo = idDoModelo ? modelos.find((m) => m.id === idDoModelo) : this.recomendado();
    if (!modelo) throw new ErroAplicacao("modelo-desconhecido", `Modelo de IA local desconhecido: ${idDoModelo}.`);
    const variante = this.variante();
    const total = modelo.modelo.tamanho + modelo.visao.tamanho + variante.tamanho;
    this.instalando = new AbortController();
    const sinal = this.instalando.signal;
    try {
      mkdirSync(this.base, { recursive: true });
      // Motor
      const pastaDoMotor = path.join(this.base, "motor", `${motor.versao}-${variante.id}`);
      let executavel = existsSync(pastaDoMotor) ? procurar(pastaDoMotor, EXECUTAVEL) : null;
      if (!executavel) {
        const pacote = path.join(this.base, "downloads", variante.arquivo);
        await baixar(`${this.o.origens?.motor ?? motor.endereco}${variante.arquivo}`, pacote, variante, (bytes) => aoProgredir(`Baixando o motor de IA: ${tamanhoLegivel(bytes)} de ${tamanhoLegivel(variante.tamanho)}`, bytes / total), sinal);
        aoProgredir("Preparando o motor de IA", variante.tamanho / total);
        const temporaria = `${pastaDoMotor}.parcial`;
        rmSync(temporaria, { recursive: true, force: true });
        await desempacotar(pacote, temporaria);
        if (!procurar(temporaria, EXECUTAVEL)) {
          rmSync(temporaria, { recursive: true, force: true });
          throw new ErroAplicacao("motor-incompleto", "O pacote do motor de IA não contém o programa esperado (llama-server).");
        }
        rmSync(pastaDoMotor, { recursive: true, force: true });
        renameSync(temporaria, pastaDoMotor);
        rmSync(pacote, { force: true });
        executavel = procurar(pastaDoMotor, EXECUTAVEL) as string;
      }
      // Modelo
      const pastaDoModelo = path.join(this.o.caminhos.modelos, "ia-local", modelo.id);
      let feito = variante.tamanho;
      for (const parte of [modelo.modelo, modelo.visao]) {
        const url = this.o.origens?.modelos?.(modelo, parte.arquivo) ?? `https://huggingface.co/${modelo.repositorio}/resolve/${modelo.revisao}/${parte.arquivo}`;
        const destino = path.join(pastaDoModelo, parte.arquivo);
        const nome = parte === modelo.modelo ? `o modelo ${modelo.nome}` : "a parte de visão do modelo";
        await baixar(url, destino, parte, (bytes) => aoProgredir(`Baixando ${nome}: ${tamanhoLegivel(bytes)} de ${tamanhoLegivel(parte.tamanho)}`, (feito + bytes) / total), sinal);
        feito += parte.tamanho;
      }
      await this.parar(); // o modelo pode ter mudado
      const instalacao: Instalacao = {
        motor: { versao: motor.versao, variante: variante.id, aceleracao: variante.aceleracao, executavel },
        modelo: { id: modelo.id, arquivo: modelo.modelo.arquivo, visao: modelo.visao.arquivo },
        instaladoEm: new Date().toISOString(),
      };
      writeFileSync(this.arquivoDaInstalacao, `${JSON.stringify(instalacao, null, 2)}\n`);
      // Modelos de outras instalações ficam ocupando espaço: só o atual é mantido.
      for (const outro of readdirSync(path.join(this.o.caminhos.modelos, "ia-local"))) if (outro !== modelo.id) rmSync(path.join(this.o.caminhos.modelos, "ia-local", outro), { recursive: true, force: true });
      for (const outro of readdirSync(path.join(this.base, "motor"))) if (outro !== `${motor.versao}-${variante.id}`) rmSync(path.join(this.base, "motor", outro), { recursive: true, force: true });
      this.ultimoErro = null;
      aoProgredir("IA local instalada", 1);
      return this.estado();
    } finally {
      this.instalando = null;
    }
  }

  cancelarInstalacao(): void {
    this.instalando?.abort();
  }

  /** Apaga o motor e o modelo. Nada mais é tocado. */
  async remover(): Promise<void> {
    await this.parar();
    rmSync(this.base, { recursive: true, force: true });
    rmSync(path.join(this.o.caminhos.modelos, "ia-local"), { recursive: true, force: true });
  }

  /** Liga o motor, se ainda não estiver ligado, e devolve a porta. Um pedido por vez liga o motor. */
  private ligar(): Promise<number> {
    if (this.processo && this.porta) return Promise.resolve(this.porta);
    this.ligando ??= this.iniciarProcesso().finally(() => {
      this.ligando = null;
    });
    return this.ligando;
  }

  private async iniciarProcesso(): Promise<number> {
    const instalacao = this.instalacao();
    if (!instalacao) throw new ErroAplicacao("ia-local-ausente", "A IA local não está instalada.");
    const modelo = this.catalogo().modelos.find((m) => m.id === instalacao.modelo.id);
    const pastaDoModelo = path.join(this.o.caminhos.modelos, "ia-local", instalacao.modelo.id);
    const tentativas: ("gpu" | "cpu")[] = instalacao.motor.aceleracao === "gpu" ? ["gpu", "cpu"] : ["cpu"];
    let falha = "";
    for (const pedido of tentativas) {
      // Só vai para a placa se couber junto com o que já está nela (o Whisper, por exemplo).
      // Ocupa da placa o que estiver livre (o motor põe o resto do modelo no processador),
      // desde que haja um mínimo útil; o Whisper e outros modelos já carregados são respeitados.
      const livre = this.o.vram.livreMB;
      const dispositivo = pedido === "gpu" && livre >= 1500 ? this.o.vram.reservar("ia-local", Math.min(modelo?.vramMB ?? 4000, livre)) : "cpu";
      if (pedido === "gpu" && dispositivo === "cpu") continue;
      const porta = await portaLivre();
      const argumentos = [
        "-m", path.join(pastaDoModelo, instalacao.modelo.arquivo), "--mmproj", path.join(pastaDoModelo, instalacao.modelo.visao),
        "--host", "127.0.0.1", "--port", String(porta), "-c", String(modelo?.contexto ?? 8192), "-ngl", dispositivo === "gpu" ? "auto" : "0",
        "--jinja", "--no-webui", "--parallel", "1",
      ];
      this.registro = "";
      const processo = spawn(instalacao.motor.executavel, argumentos, { cwd: path.dirname(instalacao.motor.executavel), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      const anotar = (bloco: Buffer) => { this.registro = (this.registro + bloco.toString()).slice(-4000); };
      processo.stdout?.on("data", anotar);
      processo.stderr?.on("data", anotar);
      let saiu = false;
      processo.on("exit", () => {
        saiu = true;
        if (this.processo === processo) this.desligado();
      });
      processo.on("error", (erro) => { saiu = true; this.registro += `\n${erro.message}`; });
      const limite = Date.now() + (this.o.esperaParaLigarSeg ?? 180) * 1000;
      while (!saiu && Date.now() < limite) {
        try {
          const resposta = await fetch(`http://127.0.0.1:${porta}/health`, { signal: AbortSignal.timeout(2000) });
          if (resposta.ok) {
            this.processo = processo;
            this.porta = porta;
            this.dispositivo = dispositivo;
            this.ultimoErro = null;
            this.agendarDesligamento();
            return porta;
          }
        } catch {
          // ainda carregando
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      if (!saiu) processo.kill();
      if (dispositivo === "gpu") this.o.vram.liberar("ia-local");
      falha = this.registro.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" | ").slice(0, 400) || (saiu ? "o motor fechou ao iniciar" : "o motor demorou demais para ficar pronto");
    }
    this.ultimoErro = falha;
    throw new ErroAplicacao("ia-local-falhou", `A IA local não pôde ser ligada: ${falha}`);
  }

  private desligado(): void {
    this.processo = null;
    this.porta = 0;
    this.dispositivo = null;
    this.o.vram.liberar("ia-local");
    if (this.relogio) clearTimeout(this.relogio);
    this.relogio = null;
  }

  private agendarDesligamento(): void {
    if (this.relogio) clearTimeout(this.relogio);
    if (this.emUso > 0) return;
    this.relogio = setTimeout(() => void this.parar(), Math.max(0.05, this.o.configuracao().desligarAposMin) * 60_000);
    this.relogio.unref();
  }

  /** Desliga o motor e devolve a memória. */
  async parar(): Promise<void> {
    const processo = this.processo;
    if (!processo) return;
    await new Promise<void>((resolver) => {
      const fim = setTimeout(() => { processo.kill("SIGKILL"); resolver(); }, 5000);
      processo.once("exit", () => { clearTimeout(fim); resolver(); });
      processo.kill();
    });
    this.desligado();
  }

  /** Faz um pedido ao motor, ligando-o se preciso. */
  async usar<T>(acao: (provedor: ProvedorCompativelOpenAI) => Promise<T>): Promise<T> {
    this.emUso += 1;
    if (this.relogio) clearTimeout(this.relogio);
    try {
      const porta = await this.ligar();
      const provedor = new ProvedorCompativelOpenAI(
        { id: "ia-local", nome: "IA local", tipo: "compativel-openai", origem: "local", urlBase: `http://127.0.0.1:${porta}/v1`, modelo: "local", capacidades: ["texto", "visao"], ativo: true },
        process.env, undefined, { response_format: { type: "json_object" } },
      );
      try {
        return await acao(provedor);
      } catch (erro) {
        this.ultimoErro = erro instanceof Error ? erro.message : String(erro);
        throw erro;
      }
    } finally {
      this.emUso -= 1;
      if (this.processo) this.agendarDesligamento();
    }
  }

  /** Confere de ponta a ponta: liga o motor, faz uma pergunta de texto e uma com imagem. */
  async testar(aoProgredir: AoProgredir = () => undefined): Promise<{ texto: string; imagem: string; enxergou: boolean; dispositivo: "gpu" | "cpu" | null; segundos: number }> {
    const inicio = Date.now();
    aoProgredir("Ligando a IA local (a primeira vez pode levar um ou dois minutos)", 0.05);
    await this.ligar();
    const pasta = path.join(this.o.caminhos.temporarios, "ia-local-teste");
    mkdirSync(pasta, { recursive: true });
    const arquivo = path.join(pasta, "teste.png");
    writeFileSync(arquivo, imagemDeTeste());
    try {
      aoProgredir("Fazendo uma pergunta de texto", 0.5);
      const texto = await this.usar((p) => p.gerarTexto({ mensagem: 'Responda só com JSON no formato {"resposta": "..."}: quanto é 2 + 3?' }));
      aoProgredir("Mostrando uma imagem de teste", 0.75);
      const imagem = await this.usar((p) => p.descreverImagens({ instrucao: 'Responda só com JSON no formato {"cor": "..."} dizendo a cor do quadrado no centro da imagem, em português.', imagens: [arquivo] }));
      aoProgredir("Teste concluído", 1);
      return { texto, imagem, enxergou: /vermelh|red/i.test(imagem), dispositivo: this.dispositivo, segundos: Math.round((Date.now() - inicio) / 100) / 10 };
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  }
}

/** A IA local vista pela camada de provedores: um provedor "local" de texto e de imagens. */
export class ProvedorIALocal implements ProvedorIA {
  id = "ia-local";
  nome = "IA local";
  origem = "local" as const;
  capacidades: Capacidade[] = ["texto", "visao"];
  private ia: IALocal;

  constructor(ia: IALocal) {
    this.ia = ia;
  }

  get modelo(): string | undefined {
    return this.ia.estado().modelo?.nome;
  }

  /** Não liga o motor: só diz se ele pode ser usado. */
  async disponivel(): Promise<boolean> {
    const estado = this.ia.estado();
    return estado.instalada && estado.ativa;
  }

  gerarTexto(pedido: PedidoTexto): Promise<string> {
    return this.ia.usar((p) => p.gerarTexto(pedido));
  }

  descreverImagens(pedido: PedidoImagens): Promise<string> {
    return this.ia.usar((p) => p.descreverImagens(pedido));
  }
}
