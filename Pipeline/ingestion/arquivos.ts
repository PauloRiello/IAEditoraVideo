// Agente de Arquivos: examina cada vídeo bruto com FFprobe e FFmpeg e informa formato,
// resolução, taxa de quadros, duração, codecs, áudio, tamanho, integridade e problemas técnicos.

import { statSync } from "node:fs";
import path from "node:path";
import type { Agente, ArquivoBruto, Problema } from "../../src/dominio/producao.ts";
import type { FormatoSaida } from "../../src/dominio/tipos.ts";
import { errosDeDecodificacao, sondarCompleto } from "../analysis/ferramentas.ts";

export const EXTENSOES_DE_VIDEO = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".ts", ".mts"]);

export class AgenteDeArquivos implements Agente {
  id = "arquivos";
  nome = "Agente de Arquivos";
  responsabilidade = "Examinar os arquivos brutos: dados técnicos, integridade e problemas.";

  /** Examina um arquivo. Nunca lança erro: um arquivo ilegível volta descrito como tal. */
  async examinar(arquivo: string, formatoDoProjeto?: FormatoSaida): Promise<ArquivoBruto> {
    const caminho = path.resolve(arquivo);
    const base: ArquivoBruto = {
      nome: path.basename(caminho), caminho, formato: path.extname(caminho).slice(1).toLowerCase(), tamanhoBytes: 0,
      tecnico: null, audio: null, integridade: "ilegivel", verificacao: "", problemas: [],
    };
    const ilegivel = (descricao: string): ArquivoBruto => ({
      ...base, verificacao: "leitura da estrutura do arquivo pelo FFprobe",
      problemas: [{ codigo: "arquivo-ilegivel", descricao, gravidade: "erro" }],
    });

    try {
      base.tamanhoBytes = statSync(caminho).size;
    } catch {
      return ilegivel("O arquivo não existe ou não pode ser aberto.");
    }
    if (base.tamanhoBytes === 0) return ilegivel("O arquivo está vazio.");

    let sonda;
    try {
      sonda = await sondarCompleto(caminho);
    } catch {
      return ilegivel("O arquivo não pôde ser lido como vídeo: está incompleto, corrompido ou não é um vídeo.");
    }
    const { tecnico } = sonda;
    const problemas: Problema[] = [];
    const aviso = (codigo: string, descricao: string) => problemas.push({ codigo, descricao, gravidade: "aviso" });

    // Integridade: vídeos de até 60 s são decodificados inteiros; os maiores, em três
    // amostras de 5 s (começo, meio e fim), para não decodificar horas de material.
    const inteiro = tecnico.duracaoSeg <= 60;
    const trechos = inteiro ? [undefined] : [0, tecnico.duracaoSeg / 2, Math.max(0, tecnico.duracaoSeg - 6)].map((inicioSeg) => ({ inicioSeg, duracaoSeg: 5 }));
    const erros = (await Promise.all(trechos.map((trecho) => errosDeDecodificacao(caminho, trecho)))).filter(Boolean);
    if (erros.length) {
      problemas.push({ codigo: "erros-de-decodificacao", descricao: `Erros ao decodificar: ${erros[0].split("\n")[0].replace(/ @ 0x[0-9a-f]+/i, "").slice(0, 160)}`, gravidade: "erro" });
    }

    if (!tecnico.temAudio) aviso("sem-audio", "O arquivo não tem áudio.");
    else if (sonda.audio?.canais === 1) aviso("audio-mono", "O áudio é mono.");
    if (Math.min(tecnico.largura, tecnico.altura) < 720) aviso("resolucao-baixa", `Resolução baixa (${tecnico.largura}×${tecnico.altura}).`);
    if (tecnico.fps > 0 && tecnico.fps < 23) aviso("fps-baixo", `Taxa de quadros baixa (${tecnico.fps} por segundo).`);
    if (sonda.taxaDeQuadrosVariavel) aviso("taxa-de-quadros-variavel", "A taxa de quadros varia ao longo do arquivo; pode haver falta de sincronia na edição.");
    const bitsPorPixel = tecnico.taxaDeBitsKbps ? (tecnico.taxaDeBitsKbps * 1000) / (tecnico.largura * tecnico.altura * Math.max(1, tecnico.fps)) : null;
    if (bitsPorPixel !== null && bitsPorPixel < 0.015) aviso("taxa-de-bits-baixa", `Taxa de bits baixa para a resolução (${tecnico.taxaDeBitsKbps} kbps): a imagem pode ter compressão visível.`);
    if (formatoDoProjeto) {
      const orientacaoDoProjeto = formatoDoProjeto.largura === formatoDoProjeto.altura ? "quadrado" : formatoDoProjeto.largura > formatoDoProjeto.altura ? "horizontal" : "vertical";
      if (orientacaoDoProjeto !== tecnico.orientacao) {
        aviso("orientacao-diferente", `O arquivo é ${tecnico.orientacao} e o projeto é ${orientacaoDoProjeto}: será preciso recortar ou reenquadrar.`);
      }
    }

    return {
      ...base, formato: sonda.formato, tecnico, audio: sonda.audio,
      integridade: erros.length ? "com-erros" : "integro",
      verificacao: inteiro ? "decodificação completa do arquivo" : "decodificação de três amostras de 5 s (começo, meio e fim)",
      problemas,
    };
  }
}
