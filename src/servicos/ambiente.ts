// Preparação do computador: FFmpeg, Python, pacotes do Whisper e detecção da placa de
// vídeo. Tudo vai para a pasta do ambiente (Caminhos.ambiente), fora da pasta do programa,
// que a atualização substitui. Só instala o que falta; a porcentagem só avança; falha numa
// parte vira aviso e o resto continua, para o programa abrir com o que ficou pronto.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { caminhoDaAceleracao, pythonDoAmbiente, type Caminhos } from "../infra/caminhos.ts";
import { baixar, desempacotar, tamanhoLegivel, type ArquivoBaixavel } from "../infra/download.ts";

export interface VarianteDaFerramenta extends ArquivoBaixavel { plataforma: string; arquitetura: string }
export interface Ferramenta { nome: string; versao: string; licenca: string; origem: string; endereco: string; variantes: VarianteDaFerramenta[] }
export interface CatalogoDeFerramentas { ffmpeg: Ferramenta; python: Ferramenta }

export interface SituacaoDoAmbiente {
  ffmpeg: boolean;
  python: boolean;
  whisper: boolean;
  aceleracao: boolean;
  /** Nomes do que ainda falta, para mostrar ao usuário. */
  faltando: string[];
}
export interface ResultadoDaPreparacao extends SituacaoDoAmbiente {
  /** O que não deu certo, dito em linguagem simples, com o que fazer. */
  avisos: string[];
}

export interface OpcoesDaPreparacao {
  caminhos: Caminhos;
  aoProgredir: (etapa: string, fracao: number) => void;
  sinal?: AbortSignal;
  /** Endereços alternativos dos pacotes (testes). */
  origens?: { ffmpeg?: string; python?: string };
  catalogo?: CatalogoDeFerramentas;
  /** O que já existe no sistema; sem isto, é procurado (testes forçam a ausência). */
  sistema?: { ffmpeg?: boolean; python?: string | null };
  /** Detecção da placa de vídeo; o padrão roda scripts/detectar_gpu.mjs. */
  detectarAceleracao?: () => Promise<void>;
}

const WINDOWS = process.platform === "win32";
const exe = (nome: string) => (WINDOWS ? `${nome}.exe` : nome);
/** Linhas do pip que marcam um pacote resolvido; usado para estimar o andamento. */
const PACOTE_DO_PIP = /^(Collecting|Requirement already satisfied:) /;
/** Quantos pacotes o requirements.txt puxa, contando dependências (medido: cerca de 30). */
const PACOTES_ESPERADOS = 30;

export const pastaDoFfmpeg = (c: Caminhos): string => path.join(c.ambiente, "ferramentas", "ffmpeg", "bin");
const pastaDoPythonPortatil = (c: Caminhos) => path.join(c.ambiente, "ferramentas", "python");
const pythonPortatil = (c: Caminhos) => (WINDOWS ? path.join(pastaDoPythonPortatil(c), "python.exe") : path.join(pastaDoPythonPortatil(c), "bin", "python3"));
const pastaDoVenv = (c: Caminhos) => path.join(c.ambiente, "python");
/** Marca dos pacotes instalados: fica no ambiente do Python em uso (o novo ou o .venv antigo). */
const marcadorDosPacotes = (c: Caminhos) => {
  const python = pythonDoAmbiente(c);
  return path.join(python ? path.dirname(path.dirname(python)) : pastaDoVenv(c), ".requisitos");
};
const requisitos = (c: Caminhos) => path.join(c.programa, "requirements.txt");

export function lerCatalogo(c: Caminhos): CatalogoDeFerramentas {
  return JSON.parse(readFileSync(path.join(c.programa, "IA", "Ambiente", "ferramentas.json"), "utf8")) as CatalogoDeFerramentas;
}

function noCaminho(nome: string): boolean {
  return (process.env.PATH ?? "").split(path.delimiter).some((pasta) => pasta && existsSync(path.join(pasta, exe(nome))));
}

function temFfmpeg(c: Caminhos, sistema?: boolean): boolean {
  if (existsSync(path.join(pastaDoFfmpeg(c), exe("ffmpeg")))) return true;
  return sistema ?? (noCaminho("ffmpeg") && noCaminho("ffprobe"));
}

/** Python 3.11+ instalado no sistema, ou null. */
function pythonDoSistema(): string | null {
  const candidatos: [string, string[]][] = WINDOWS ? [["py", ["-3"]], ["python", []], ["python3", []]] : [["python3", []], ["python", []]];
  for (const [comando, argumentos] of candidatos) {
    const r = spawnSync(comando, [...argumentos, "-c", "import sys; print(sys.executable); print('%d.%d' % sys.version_info[:2])"], { encoding: "utf8", windowsHide: true });
    if (r.status !== 0) continue;
    const [executavel, versao] = r.stdout.trim().split(/\r?\n/);
    const [maior, menor] = versao.split(".").map(Number);
    if (maior === 3 && menor >= 11) return executavel;
  }
  return null;
}

const somaDosRequisitos = (c: Caminhos) => createHash("sha256").update(readFileSync(requisitos(c))).digest("hex");
const pacotesEmDia = (c: Caminhos) => existsSync(marcadorDosPacotes(c)) && readFileSync(marcadorDosPacotes(c), "utf8").trim() === somaDosRequisitos(c);

export function situacaoDoAmbiente(c: Caminhos, sistema?: OpcoesDaPreparacao["sistema"]): SituacaoDoAmbiente {
  const python = pythonDoAmbiente(c) !== null;
  const s = { ffmpeg: temFfmpeg(c, sistema?.ffmpeg), python, whisper: python && pacotesEmDia(c), aceleracao: existsSync(caminhoDaAceleracao(c)) };
  const faltando = [s.ffmpeg ? null : "FFmpeg", s.python ? null : "Python", s.python && !s.whisper ? "Whisper" : null, s.aceleracao ? null : "Detecção da placa de vídeo"];
  return { ...s, faltando: faltando.filter((f): f is string => f !== null) };
}

/** Executa um programa sem janela, passando cada linha da saída. */
function rodar(comando: string, argumentos: string[], o: { aoLinha?: (linha: string) => void; sinal?: AbortSignal; env?: NodeJS.ProcessEnv } = {}): Promise<{ codigo: number | null; saida: string }> {
  return new Promise((resolver) => {
    const processo = spawn(comando, argumentos, { windowsHide: true, signal: o.sinal, env: o.env ?? process.env });
    let saida = "";
    let resto = "";
    const ler = (bloco: Buffer) => {
      saida = (saida + bloco.toString()).slice(-4000);
      const linhas = (resto + bloco.toString()).split(/\r?\n/);
      resto = linhas.pop() ?? "";
      for (const linha of linhas) o.aoLinha?.(linha);
    };
    processo.stdout.on("data", ler);
    processo.stderr.on("data", ler);
    processo.on("error", (erro) => resolver({ codigo: null, saida: erro.message }));
    processo.on("close", (codigo) => resolver({ codigo, saida }));
  });
}

const resumo = (texto: string) => texto.trim().split(/\r?\n/).slice(-3).join(" ").slice(0, 300);
const motivo = (erro: unknown) => (erro instanceof Error ? erro.message : String(erro));

export async function prepararAmbiente(o: OpcoesDaPreparacao): Promise<ResultadoDaPreparacao> {
  const c = o.caminhos;
  const catalogo = o.catalogo ?? lerCatalogo(c);
  const avisos: string[] = [];
  let atual = 0;
  const informar = (etapa: string, fracao: number) => {
    atual = Math.max(atual, Math.min(1, fracao));
    o.aoProgredir(etapa, atual);
  };
  const variante = (f: Ferramenta) => f.variantes.find((v) => v.plataforma === process.platform && v.arquitetura === process.arch);
  /** Baixa e desempacota um pacote do catálogo; devolve a pasta desempacotada. */
  const obter = async (f: Ferramenta, v: VarianteDaFerramenta, origem: string | undefined, de: number, ate: number): Promise<string> => {
    const destino = path.join(c.ambiente, "downloads", v.arquivo);
    await baixar(`${origem ?? f.endereco}${encodeURIComponent(v.arquivo)}`, destino, v,
      (bytes) => informar(`Baixando ${f.nome.split(" (")[0]}: ${tamanhoLegivel(bytes)} de ${tamanhoLegivel(v.tamanho)}`, de + ((ate - de) * 0.9 * bytes) / v.tamanho), o.sinal);
    informar(`Desempacotando ${f.nome.split(" (")[0]}`, de + (ate - de) * 0.9);
    const pasta = path.join(c.ambiente, "downloads", `${v.arquivo}.conteudo`);
    rmSync(pasta, { recursive: true, force: true });
    await desempacotar(destino, pasta);
    rmSync(destino, { force: true }); // o pacote já conferido não é mais necessário
    return pasta;
  };
  informar("Conferindo o que já está instalado", 0);

  // 1. FFmpeg (0 a 25%) -------------------------------------------------------
  if (!temFfmpeg(c, o.sistema?.ffmpeg)) {
    const v = variante(catalogo.ffmpeg);
    if (!v) avisos.push("O FFmpeg não foi encontrado. Instale-o pelo gerenciador de pacotes do sistema e abra o programa de novo.");
    else {
      try {
        const pasta = await obter(catalogo.ffmpeg, v, o.origens?.ffmpeg, 0, 0.25);
        const raiz = [pasta, ...readdirSync(pasta).map((nome) => path.join(pasta, nome))].find((p) => existsSync(path.join(p, "bin", exe("ffmpeg"))));
        if (!raiz) throw new Error("o pacote não tem bin/ffmpeg");
        const destino = path.dirname(pastaDoFfmpeg(c));
        rmSync(destino, { recursive: true, force: true });
        mkdirSync(path.dirname(destino), { recursive: true });
        renameSync(raiz, destino);
        rmSync(pasta, { recursive: true, force: true });
      } catch (erro) {
        avisos.push(`O FFmpeg não foi instalado: ${motivo(erro)}`);
      }
    }
  }
  informar("FFmpeg pronto", 0.25);

  // 2 e 3. Python e ambiente virtual (25 a 45%) -------------------------------
  if (!pythonDoAmbiente(c)) {
    let base = o.sistema && "python" in o.sistema ? o.sistema.python : pythonDoSistema();
    if (!base && existsSync(pythonPortatil(c))) base = pythonPortatil(c);
    if (!base) {
      const v = variante(catalogo.python);
      if (!v) avisos.push("O Python 3.11 ou mais recente não foi encontrado. Instale-o e abra o programa de novo.");
      else {
        try {
          const pasta = await obter(catalogo.python, v, o.origens?.python, 0.25, 0.4);
          rmSync(pastaDoPythonPortatil(c), { recursive: true, force: true });
          mkdirSync(path.dirname(pastaDoPythonPortatil(c)), { recursive: true });
          renameSync(path.join(pasta, "python"), pastaDoPythonPortatil(c));
          rmSync(pasta, { recursive: true, force: true });
          base = pythonPortatil(c);
        } catch (erro) {
          avisos.push(`O Python não foi instalado: ${motivo(erro)}`);
        }
      }
    }
    informar("Python pronto", 0.4);
    if (base) {
      informar("Criando o ambiente do Python", 0.4);
      const r = await rodar(base, ["-m", "venv", pastaDoVenv(c)], { sinal: o.sinal });
      if (r.codigo !== 0 || !pythonDoAmbiente(c)) avisos.push(`O ambiente do Python não pôde ser criado: ${resumo(r.saida)}`);
    }
  }
  informar("Ambiente do Python pronto", 0.45);

  // 4. Pacotes do Whisper (45 a 85%) ------------------------------------------
  const python = pythonDoAmbiente(c);
  let pacotesInstalados = false;
  if (python && !pacotesEmDia(c)) {
    let resolvidos = 0;
    informar("Instalando os pacotes do Whisper (pode levar alguns minutos)", 0.45);
    const r = await rodar(python, ["-m", "pip", "install", "--disable-pip-version-check", "-r", requisitos(c)], {
      sinal: o.sinal,
      aoLinha: (linha) => {
        if (!PACOTE_DO_PIP.test(linha)) return;
        resolvidos += 1;
        informar(`Instalando os pacotes do Whisper: ${resolvidos} prontos`, 0.45 + 0.4 * Math.min(0.95, resolvidos / PACOTES_ESPERADOS));
      },
    });
    if (r.codigo === 0) {
      writeFileSync(marcadorDosPacotes(c), somaDosRequisitos(c));
      pacotesInstalados = true;
    } else avisos.push(`Os pacotes do Whisper não foram instalados (a transcrição fica indisponível): ${resumo(r.saida)}`);
  }
  informar("Pacotes prontos", 0.85);

  // 5 e 6. Placa de vídeo e bibliotecas CUDA (85 a 100%) ----------------------
  const detectar = o.detectarAceleracao ?? (() => detectarComScript(c));
  if (!existsSync(caminhoDaAceleracao(c)) || pacotesInstalados) {
    informar("Detectando a placa de vídeo", 0.85);
    try {
      await detectar();
      const aceleracao = JSON.parse(readFileSync(caminhoDaAceleracao(c), "utf8")) as { whisper?: { bibliotecasCudaPendentes?: boolean } };
      if (aceleracao.whisper?.bibliotecasCudaPendentes && python) {
        informar("Instalando as bibliotecas da placa NVIDIA para o Whisper (cerca de 1 GB)", 0.95);
        const r = await rodar(python, ["-m", "pip", "install", "--disable-pip-version-check", "-r", path.join(c.programa, "requirements-gpu-nvidia.txt")], { sinal: o.sinal });
        if (r.codigo !== 0) avisos.push(`As bibliotecas da placa NVIDIA não foram instaladas; a transcrição usa o processador: ${resumo(r.saida)}`);
        await detectar();
      }
    } catch (erro) {
      avisos.push(`A placa de vídeo não pôde ser detectada; o programa usa o processador: ${motivo(erro)}`);
    }
  }
  informar("Computador preparado", 1);
  return { ...situacaoDoAmbiente(c, o.sistema), avisos };
}

/** Roda a detecção de placa de vídeo dos scripts, gravando no ambiente. */
async function detectarComScript(c: Caminhos): Promise<void> {
  const env = { ...process.env, IAEV_AMBIENTE: c.ambiente, PATH: `${pastaDoFfmpeg(c)}${path.delimiter}${process.env.PATH ?? ""}` };
  const r = await rodar(process.execPath, [path.join(c.programa, "scripts", "detectar_gpu.mjs")], { env });
  if (r.codigo !== 0) throw new Error(resumo(r.saida));
}
