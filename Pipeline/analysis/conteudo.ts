// Agente de Conteúdo: divide o vídeo bruto em cenas, mede ação e som, transcreve a fala,
// aponta destaques e possíveis erros de gravação, gera miniaturas e monta o índice de pesquisa.
// Reaproveita a medição usada na análise de referências.

import { estimado, naoAvaliado, type Transcricao } from "../../src/dominio/analise.ts";
import type { Agente, AnaliseDeConteudo, ArquivoBruto, Cena, EntradaDoIndice, Problema } from "../../src/dominio/producao.ts";
import type { ProvedorIA } from "../../src/dominio/provedores.ts";
import { medirAudio } from "./audio.ts";
import { arredondar, extrairQuadros } from "./ferramentas.ts";
import type { SeletorDeProvedores } from "./interpretacao.ts";
import { medirVisual } from "./visual.ts";

const DURACAO_MAXIMA_DA_CENA = 8;
const MAXIMO_DE_MINIATURAS = 24;
const ACAO_PLENA = 12; // diferença média entre quadros que corresponde a ação máxima
const LIMIAR_DE_ACAO = 0.35;

export interface ContextoDeConteudo {
  pastaDeMiniaturas: string;
  transcrever?: (arquivo: string) => Promise<Transcricao>;
  provedores?: SeletorDeProvedores;
}

const sobrepoe = (a: { inicioSeg: number; fimSeg: number }, b: { inicioSeg: number; fimSeg: number }) => a.inicioSeg < b.fimSeg && b.inicioSeg < a.fimSeg;

function lerJson(texto: string): Record<string, unknown> | null {
  const inicio = texto.indexOf("{"), fim = texto.lastIndexOf("}");
  if (inicio < 0 || fim <= inicio) return null;
  try {
    return JSON.parse(texto.slice(inicio, fim + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export class AgenteDeConteudo implements Agente {
  id = "conteudo";
  nome = "Agente de Conteúdo";
  responsabilidade = "Entender o que há em cada vídeo bruto: cenas, ação, falas, silêncios, destaques e possíveis erros.";

  async analisar(midiaId: string, arquivo: ArquivoBruto, contexto: ContextoDeConteudo): Promise<AnaliseDeConteudo> {
    if (!arquivo.tecnico) throw new Error(`O arquivo ${arquivo.nome} não pôde ser lido e não tem conteúdo a analisar.`);
    const limitacoes: string[] = [];
    const visual = await medirVisual(arquivo.caminho, arquivo.tecnico);
    const audio = arquivo.tecnico.temAudio ? await medirAudio(arquivo.caminho, visual.cortesSeg) : null;

    let transcricao: Transcricao | null = null;
    if (audio?.audivel && contexto.transcrever) {
      try {
        transcricao = await contexto.transcrever(arquivo.caminho);
      } catch (erro) {
        const motivo = (erro instanceof Error ? erro.message : String(erro)).split(/\r?\n/).filter(Boolean).slice(-2).join(" ").slice(0, 300);
        console.error(`${new Date().toISOString()} Transcrição falhou em ${arquivo.caminho ?? arquivo}: ${motivo}`);
        limitacoes.push(`A fala não foi transcrita: a execução do Whisper falhou (${motivo}).`);
      }
    } else if (audio?.audivel) limitacoes.push("A fala não foi transcrita: o Whisper não está disponível.");

    // --- Possíveis erros de gravação ---------------------------------------------
    const possiveisErros: Problema[] = [
      ...visual.sinais.pretos.map((t) => ({ codigo: "tela-preta", descricao: "Trecho de tela preta.", gravidade: "aviso" as const, ...t })),
      ...visual.sinais.congelados.map((t) => ({ codigo: "imagem-parada", descricao: "Imagem congelada ou totalmente parada.", gravidade: "aviso" as const, ...t })),
      ...visual.sinais.escuros.map((t) => ({ codigo: "imagem-escura", descricao: "Trecho muito escuro.", gravidade: "aviso" as const, ...t })),
      ...(audio?.silencios.valor ?? []).filter((s) => s.fimSeg - s.inicioSeg >= 3).map((t) => ({ codigo: "silencio-longo", descricao: "Silêncio de 3 s ou mais.", gravidade: "aviso" as const, ...t })),
    ];
    if (audio && audio.estouro > 0.005) possiveisErros.push({ codigo: "audio-estourado", descricao: `Áudio estourado em ${arredondar(audio.estouro * 100, 1)}% das amostras.`, gravidade: "aviso" });

    // --- Cenas: cada plano, dividido em partes de até 8 s ------------------------
    const atividade = visual.sinais.atividadePorSegundo;
    const curva = audio?.curvaDeIntensidadeDb ?? [];
    const media = (valores: number[], inicio: number, fim: number) => {
      const trecho = valores.slice(Math.floor(inicio), Math.max(Math.floor(inicio) + 1, Math.ceil(fim)));
      return trecho.length ? trecho.reduce((s, v) => s + v, 0) / trecho.length : 0;
    };
    const cenas: Cena[] = [];
    for (const plano of visual.planos) {
      const partes = Math.max(1, Math.ceil(plano.duracaoSeg / DURACAO_MAXIMA_DA_CENA));
      for (let k = 0; k < partes; k += 1) {
        const inicioSeg = arredondar(plano.inicioSeg + (k * plano.duracaoSeg) / partes), fimSeg = arredondar(plano.inicioSeg + ((k + 1) * plano.duracaoSeg) / partes);
        const trecho = { inicioSeg, fimSeg };
        const acao = arredondar(Math.min(1, media(atividade, inicioSeg, fimSeg) / ACAO_PLENA));
        const volumeDb = curva.length ? arredondar(media(curva, inicioSeg, fimSeg), 1) : null;
        const fala = (transcricao?.segmentos ?? []).filter((s) => sobrepoe(s, trecho)).map((s) => s.texto).join(" ");
        const defeitos = possiveisErros.filter((p) => p.inicioSeg !== undefined && p.codigo !== "silencio-longo" && sobrepoe(p as Required<Problema>, trecho));
        const silencioso = (audio?.silencios.valor ?? []).some((s) => s.inicioSeg <= inicioSeg && s.fimSeg >= fimSeg);
        // Relevância: ação na imagem, volume e presença de fala; trechos com defeito perdem quase tudo.
        const volume = volumeDb === null ? 0 : Math.max(0, Math.min(1, (volumeDb + 50) / 40));
        // Imagem parada com alguém falando não é defeito (apresentação, tela fixa, entrevista).
        const graves = defeitos.filter((d) => d.codigo !== "imagem-parada" || !fala);
        const pontuacao = arredondar((0.45 * acao + 0.25 * volume + 0.3 * (fala ? 1 : 0)) * (graves.length ? 0.2 : 1));
        const etiquetas = [
          plano.movimento ?? "", acao >= LIMIAR_DE_ACAO ? "acao" : "calmo", fala ? "fala" : "", silencioso ? "silencio" : "",
          ...graves.map((d) => d.codigo),
        ].filter(Boolean);
        cenas.push({ indice: cenas.length, inicioSeg, fimSeg, duracaoSeg: arredondar(fimSeg - inicioSeg), movimento: plano.movimento, acao, volumeDb, fala, elementos: [], miniatura: null, pontuacao, etiquetas });
      }
    }

    // Momentos de ação: segundos seguidos com muito movimento na imagem.
    const momentosDeAcao: AnaliseDeConteudo["momentosDeAcao"] = [];
    for (let s = 0; s < atividade.length; ) {
      if (atividade[s] / ACAO_PLENA < LIMIAR_DE_ACAO) { s += 1; continue; }
      let fim = s;
      while (fim < atividade.length && atividade[fim] / ACAO_PLENA >= LIMIAR_DE_ACAO) fim += 1;
      momentosDeAcao.push({ inicioSeg: s, fimSeg: Math.min(fim, arquivo.tecnico.duracaoSeg), intensidade: arredondar(Math.min(1, media(atividade, s, fim) / ACAO_PLENA)) });
      s = fim;
    }

    // Destaques: as cenas mais bem pontuadas (as 20% melhores, com nota de pelo menos 0,4).
    const notas = cenas.map((c) => c.pontuacao).sort((a, b) => b - a);
    const corte = Math.max(0.4, notas[Math.floor(notas.length * 0.2)] ?? 0);
    const destaques = cenas.filter((c) => c.pontuacao >= corte).map((c) => c.indice);
    for (const indice of destaques) cenas[indice].etiquetas.push("destaque");

    // Miniaturas: uma por cena, até 24 por arquivo, espalhadas pelo vídeo.
    const comMiniatura = cenas.length <= MAXIMO_DE_MINIATURAS ? cenas : Array.from({ length: MAXIMO_DE_MINIATURAS }, (_, k) => cenas[Math.floor((k * cenas.length) / MAXIMO_DE_MINIATURAS)]);
    const miniaturas = await extrairQuadros(arquivo.caminho, comMiniatura.map((c) => arredondar((c.inicioSeg + c.fimSeg) / 2)), contexto.pastaDeMiniaturas, 320);
    comMiniatura.forEach((cena, k) => (cena.miniatura = miniaturas[k]));

    // --- Leitura por modelos, quando houver --------------------------------------
    const analise: AnaliseDeConteudo = {
      midiaId, cenas, silencios: audio?.silencios.valor ?? [], transcricao, momentosDeAcao, destaques, possiveisErros,
      personagensEElementos: naoAvaliado("requer modelo visual; nenhum provedor com a capacidade \"visao\" está disponível"),
      humor: naoAvaliado("requer modelo de linguagem; nenhum provedor com a capacidade \"texto\" está disponível"),
      limitacoes,
    };
    await this.lerElementosVisuais(analise, comMiniatura.slice(0, 8), contexto.provedores);
    await this.lerHumor(analise, contexto.provedores);
    return analise;
  }

  /** Personagens e elementos visuais: um modelo visual descreve as miniaturas. */
  private async lerElementosVisuais(analise: AnaliseDeConteudo, cenas: Cena[], provedores?: SeletorDeProvedores): Promise<void> {
    let provedor: ProvedorIA;
    try {
      provedor = await (provedores?.selecionar("visao") ?? Promise.reject(new Error("sem provedores")));
    } catch {
      analise.limitacoes.push("Personagens e elementos visuais não foram identificados: nenhum modelo visual disponível. Instale a IA local em Configurações para avaliar.");
      return;
    }
    try {
      const resposta = await provedor.descreverImagens!({
        imagens: cenas.map((c) => c.miniatura as string),
        instrucao:
          "As imagens são quadros de um vídeo bruto, em ordem. Para cada quadro, liste os personagens e elementos visíveis (pessoas, veículos, cenários, objetos, texto na tela). " +
          'Responda somente com JSON: {"quadros": [{"n": 1, "elementos": ["...", "..."]}]}. Use palavras curtas em português e liste apenas o que é visível.',
      });
      const quadros = (lerJson(resposta)?.quadros ?? null) as { n?: number; elementos?: unknown }[] | null;
      if (!Array.isArray(quadros)) throw new Error("resposta sem JSON");
      for (const quadro of quadros) {
        const cena = cenas[(quadro.n ?? 0) - 1];
        if (cena && Array.isArray(quadro.elementos)) cena.elementos = quadro.elementos.filter((e): e is string => typeof e === "string").slice(0, 12);
      }
      const todos = [...new Set(cenas.flatMap((c) => c.elementos))];
      analise.personagensEElementos = estimado(todos, `modelo visual "${provedor.id}" sobre ${cenas.length} miniaturas`, 0.6);
    } catch (erro) {
      analise.limitacoes.push(`A identificação de elementos visuais falhou (${erro instanceof Error ? erro.message : erro}).`);
    }
  }

  /** Humor: um modelo de linguagem aponta quais falas transcritas têm tom de humor. */
  private async lerHumor(analise: AnaliseDeConteudo, provedores?: SeletorDeProvedores): Promise<void> {
    const segmentos = analise.transcricao?.segmentos ?? [];
    if (segmentos.length === 0) {
      analise.humor = naoAvaliado("sem fala transcrita para avaliar");
      return;
    }
    let provedor: ProvedorIA;
    try {
      provedor = await (provedores?.selecionar("texto") ?? Promise.reject(new Error("sem provedores")));
    } catch {
      analise.limitacoes.push("Humor não foi avaliado: nenhum modelo de linguagem disponível. Instale a IA local em Configurações para avaliar.");
      return;
    }
    try {
      const resposta = await provedor.gerarTexto!({
        sistema: "Você classifica falas transcritas de um vídeo bruto. Não reescreva nem complete as falas.",
        mensagem: `Falas numeradas:\n${segmentos.map((s, i) => `${i + 1}. ${s.texto}`).join("\n")}\n\nResponda somente com JSON: {"humor": [números das falas com tom de humor]}.`,
      });
      const numeros = lerJson(resposta)?.humor;
      if (!Array.isArray(numeros)) throw new Error("resposta sem JSON");
      const falas = numeros.map((n) => segmentos[Number(n) - 1]).filter(Boolean);
      analise.humor = estimado(falas, `modelo de linguagem "${provedor.id}" sobre a transcrição`, 0.5);
      for (const fala of falas) for (const cena of analise.cenas) if (sobrepoe(fala, cena) && !cena.etiquetas.includes("humor")) cena.etiquetas.push("humor");
    } catch (erro) {
      analise.limitacoes.push(`A avaliação de humor falhou (${erro instanceof Error ? erro.message : erro}).`);
    }
  }

  /** Monta as entradas do índice de pesquisa a partir do arquivo e da análise. */
  indexar(arquivo: ArquivoBruto, analise: AnaliseDeConteudo | null): EntradaDoIndice[] {
    const t = arquivo.tecnico;
    const entradas: EntradaDoIndice[] = [{
      tipo: "arquivo", inicioSeg: 0, fimSeg: t?.duracaoSeg ?? 0, texto: arquivo.nome, pontuacao: 0,
      etiquetas: [
        arquivo.formato, arquivo.integridade, ...(t ? [t.orientacao, `${t.largura}x${t.altura}`, `${Math.min(t.largura, t.altura)}p`, `${Math.round(t.fps)}fps`, t.codecVideo] : []),
        ...arquivo.problemas.map((p) => p.codigo),
      ],
    }];
    if (!analise) return entradas;
    for (const cena of analise.cenas) {
      entradas.push({ tipo: "cena", inicioSeg: cena.inicioSeg, fimSeg: cena.fimSeg, texto: [cena.fala, ...cena.elementos].filter(Boolean).join(" "), etiquetas: cena.etiquetas, pontuacao: cena.pontuacao });
    }
    for (const fala of analise.transcricao?.segmentos ?? []) {
      entradas.push({ tipo: "fala", inicioSeg: fala.inicioSeg, fimSeg: fala.fimSeg, texto: fala.texto, etiquetas: ["fala", "dialogo"], pontuacao: 0.5 });
    }
    for (const acao of analise.momentosDeAcao) {
      entradas.push({ tipo: "acao", inicioSeg: acao.inicioSeg, fimSeg: acao.fimSeg, texto: "momento de ação", etiquetas: ["acao", "movimento"], pontuacao: acao.intensidade });
    }
    for (const silencio of analise.silencios) {
      entradas.push({ tipo: "silencio", inicioSeg: silencio.inicioSeg, fimSeg: silencio.fimSeg, texto: "silêncio", etiquetas: ["silencio"], pontuacao: 0 });
    }
    for (const erro of analise.possiveisErros) {
      entradas.push({ tipo: "problema", inicioSeg: erro.inicioSeg ?? 0, fimSeg: erro.fimSeg ?? (t?.duracaoSeg ?? 0), texto: erro.descricao, etiquetas: [erro.codigo, "problema", "erro"], pontuacao: 0 });
    }
    return entradas;
  }
}
