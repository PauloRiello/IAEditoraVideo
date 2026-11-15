// Analisador de referências: mede o vídeo, interpreta o que foi medido e devolve um
// relatório com regras de edição reutilizáveis. Não depende do banco nem de provedor de IA.

import {
  estimado, naoAvaliado,
  type AnaliseAudio, type Caracteristica, type RelatorioReferencia, type Transcricao,
} from "../../src/dominio/analise.ts";
import type { Perfil } from "../../src/dominio/tipos.ts";
import { medirAudio } from "./audio.ts";
import { extrairQuadros, sondar } from "./ferramentas.ts";
import {
  leituraVisualPorModelo, narrativaPorMedicao, narrativaPorModelo, reconhecerTipos, sinaisMedidos, type SeletorDeProvedores,
} from "./interpretacao.ts";
import { derivarRegras, perfilDeEstilo } from "./regras.ts";
import { medirVisual } from "./visual.ts";

export interface ContextoDeAnalise {
  titulo: string;
  referenciaId?: string;
  perfil: Perfil;
  /** Provedores de IA opcionais. Sem eles, a análise entrega só o que pode ser medido. */
  provedores?: SeletorDeProvedores;
  /** Transcreve a fala. Ausente = transcrição não disponível. */
  transcrever?: (arquivo: string) => Promise<Transcricao>;
  /** Pasta onde os quadros-chave são gravados quando há modelo visual. */
  pastaDeQuadros?: string;
}

export async function analisarReferencia(arquivo: string, contexto: ContextoDeAnalise): Promise<RelatorioReferencia> {
  const limitacoes: string[] = [];
  const modelosUsados: string[] = [];
  const tecnico = await sondar(arquivo);
  const visual = await medirVisual(arquivo, tecnico);

  // --- Áudio e fala -------------------------------------------------------------
  let audio: AnaliseAudio | null = null;
  let transcricao: Transcricao | null = null;
  const medicaoAudio = tecnico.temAudio ? await medirAudio(arquivo, visual.cortesSeg) : null;
  if (!medicaoAudio) limitacoes.push("O arquivo não tem faixa de áudio: nenhuma análise sonora foi feita.");
  else {
    let fala: Caracteristica<Transcricao>;
    if (!medicaoAudio.audivel) fala = naoAvaliado("áudio inaudível: transcrição dispensada");
    else if (!contexto.transcrever) {
      fala = naoAvaliado("Whisper não disponível nesta instalação");
      limitacoes.push("A fala não foi transcrita: o Whisper não está disponível.");
    } else {
      try {
        transcricao = await contexto.transcrever(arquivo);
        fala = estimado(transcricao, "transcrição pelo Whisper, com filtro de voz", transcricao.segmentos.length ? 0.8 : 0.7);
        modelosUsados.push("whisper: transcrição");
      } catch (erro) {
        fala = naoAvaliado(`a transcrição falhou: ${erro instanceof Error ? erro.message : erro}`);
const motivo = (erro instanceof Error ? erro.message : String(erro)).split(/\r?\n/).filter(Boolean).slice(-2).join(" ").slice(0, 300);
        console.error(`${new Date().toISOString()} Transcrição falhou em ${arquivo}: ${motivo}`);
        limitacoes.push(`A fala não foi transcrita: a execução do Whisper falhou (${motivo}).`);
      }
    }
    const { audivel: _audivel, estouro: _estouro, ...medido } = medicaoAudio;
    audio = {
      ...medido,
      fala,
      efeitosSonoros: naoAvaliado("distinguir efeitos sonoros de música e fala exige um modelo de classificação de áudio"),
      dialogosENarracao: naoAvaliado("distinguir diálogo de narração exige modelo de linguagem ou visual"),
    };
  }

  // --- Interpretação ------------------------------------------------------------
  const narrativa = narrativaPorMedicao(contexto.perfil, tecnico, visual, medicaoAudio, transcricao);
  const tiposDeConteudo = reconhecerTipos(contexto.perfil, sinaisMedidos(visual, medicaoAudio, transcricao, tecnico), transcricao);

  const leitura = await leituraVisualPorModelo(
    contexto.provedores,
    async () => {
      const quadros = await extrairQuadros(arquivo, visual.temposDosQuadrosChave, contexto.pastaDeQuadros ?? `${arquivo}.quadros`);
      visual.amostragem.quadrosChave = quadros;
      return quadros;
    },
    limitacoes, modelosUsados,
  );
  if (leitura.legendas.base === "nao-avaliado" && tecnico.faixasDeLegenda > 0) {
    leitura.legendas = { valor: `${tecnico.faixasDeLegenda} faixa(s) de legenda embutida(s) no arquivo`, base: "observado", confianca: 0.95, metodo: "faixas do arquivo lidas pelo FFprobe" };
  }

  const { cortesSeg: _cortes, temposDosQuadrosChave: _tempos, sinais: _sinais, ...medidoVisual } = visual;
  const parcial = { tecnico, visual: { ...medidoVisual, ...leitura }, audio, narrativa };
  const regras = derivarRegras(parcial);

  const resumo = {
    perfil: contexto.perfil.id,
    tecnico: { duracaoSeg: tecnico.duracaoSeg, orientacao: tecnico.orientacao },
    ritmo: visual.ritmo.valor, transicoes: visual.tiposDeTransicao.valor, movimento: visual.movimentoDeCamera.valor,
    audio: audio && { batidas: audio.batidas.valor, sincronia: audio.sincroniaComCortes.valor, mudancas: audio.mudancasDeIntensidade.valor },
    leituraVisual: Object.fromEntries(Object.entries(leitura).map(([chave, c]) => [chave, c.valor])),
    transcricao: transcricao?.segmentos.slice(0, 80) ?? null,
  };
  const sugeridas = await narrativaPorModelo(contexto.provedores, narrativa, resumo, limitacoes, modelosUsados);
  // Uma regra sugerida pelo modelo não substitui uma regra medida sobre o mesmo assunto.
  for (const regra of sugeridas) if (!regras.some((r) => r.categoria === regra.categoria && r.chave === regra.chave)) regras.push(regra);

  const confiancaGeral = regras.length ? Math.round((regras.reduce((s, r) => s + r.confianca, 0) / regras.length) * 100) / 100 : 0;
  return {
    versao: 1,
    referencia: { id: contexto.referenciaId ?? null, titulo: contexto.titulo, arquivo },
    perfil: contexto.perfil.id,
    analisadoEm: new Date().toISOString(),
    tecnico,
    visual: parcial.visual,
    audio,
    narrativa,
    tiposDeConteudo,
    perfilDeEstilo: perfilDeEstilo(regras),
    regras,
    confiancaGeral,
    modelosUsados,
    limitacoes,
  };
}
