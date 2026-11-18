// Interpretação do que foi medido: narrativa, tipos de conteúdo e, quando houver um
// provedor de IA disponível, leitura visual e narrativa por modelo.
// Tudo o que sai daqui é marcado como "estimado", "nao-avaliado" ou "nao-aplicavel".

import {
  estimado, naoAplicavel, naoAvaliado,
  type AnaliseNarrativa, type AnaliseVisual, type Caracteristica, type DadosTecnicos, type ElementoNarrativo, type RegraDeEdicao, type Transcricao,
} from "../../src/dominio/analise.ts";
import { CATEGORIAS_EDICAO, type CategoriaEdicao } from "../../src/dominio/memoria.ts";
import type { Capacidade, ProvedorIA } from "../../src/dominio/provedores.ts";
import type { Perfil } from "../../src/dominio/tipos.ts";
import type { MedicaoAudio } from "./audio.ts";
import type { MedicaoVisual } from "./visual.ts";

export interface SeletorDeProvedores {
  selecionar(capacidade: Capacidade): Promise<ProvedorIA>;
}

const SEM_MODELO_VISUAL = "requer modelo visual; nenhum provedor com a capacidade \"visao\" está disponível";
const SEM_MODELO_DE_TEXTO = "requer modelo de linguagem; nenhum provedor com a capacidade \"texto\" está disponível";

/** Vídeos curtos de divulgação esperam gancho e CTA; os demais formatos não. */
export function estruturaNarrativa(perfil: Perfil, tecnico: DadosTecnicos): "curta" | "livre" {
  const configurada = perfil.analise?.estrutura ?? "automatica";
  if (configurada !== "automatica") return configurada;
  return tecnico.duracaoSeg <= 90 || tecnico.orientacao === "vertical" ? "curta" : "livre";
}

/** Sinais simples derivados das medições, usados para reconhecer tipos de conteúdo. */
export function sinaisMedidos(visual: MedicaoVisual, audio: MedicaoAudio | null, fala: Transcricao | null, tecnico: DadosTecnicos): Set<string> {
  const sinais = new Set<string>();
  const ritmo = visual.ritmo.valor;
  if (ritmo) {
    if (ritmo.cortesPorMinuto >= 30) sinais.add("ritmo-rapido");
    if (ritmo.cortesPorMinuto < 12) sinais.add("ritmo-lento");
    if (ritmo.duracaoMedianaSeg > 4) sinais.add("planos-longos");
  }
  if (visual.composicao.valor?.barrasDeCinema) sinais.add("barras-de-cinema");
  const movimento = visual.movimentoDeCamera.valor;
  if (movimento && movimento.panoramica + movimento["zoom-in"] + movimento["zoom-out"] >= 0.3) sinais.add("camera-em-movimento");
  const temMusica = Boolean(audio?.batidas.valor?.bpm);
  sinais.add(temMusica ? "musica" : "sem-musica");
  const sincronia = audio?.sincroniaComCortes.valor;
  if (sincronia && sincronia.cortesAvaliados >= 3 && sincronia.fracao >= 0.5 && sincronia.fracao > sincronia.fracaoEsperadaAoAcaso + 0.15) sinais.add("sincronia-musical");
  const proporcaoDeFala = fala ? fala.tempoDeFalaSeg / Math.max(1, tecnico.duracaoSeg) : 0;
  sinais.add(proporcaoDeFala >= 0.15 ? "fala" : "sem-fala");
  return sinais;
}

/** Pontua os tipos de conteúdo do perfil pelos sinais medidos e pelas palavras ditas. */
export function reconhecerTipos(perfil: Perfil, sinais: Set<string>, fala: Transcricao | null): Caracteristica<{ id: string; nome: string; pontuacao: number }[]> {
  const tipos = perfil.analise?.tiposDeConteudo ?? [];
  if (tipos.length === 0) return naoAplicavel(`o perfil "${perfil.id}" não define tipos de conteúdo`);
  const texto = ` ${(fala?.texto ?? "").toLowerCase()} `;
  const pontuados = tipos
    .map((tipo) => {
      const atendidos = tipo.sinais.filter((sinal) =>
        sinal === "palavras" ? (tipo.palavras ?? []).some((palavra) => texto.includes(palavra.toLowerCase())) : sinais.has(sinal),
      ).length;
      return { id: tipo.id, nome: tipo.nome, pontuacao: Math.round((atendidos / tipo.sinais.length) * 100) / 100 };
    })
    .filter((tipo) => tipo.pontuacao >= 0.5)
    .sort((a, b) => b.pontuacao - a.pontuacao);
  return estimado(pontuados, "sinais medidos de ritmo, áudio, composição e palavras ditas, comparados com os tipos definidos no perfil", pontuados.length ? 0.2 + 0.3 * pontuados[0].pontuacao : 0.2);
}

/** Leitura narrativa só com o que foi medido, sem modelo de linguagem. */
export function narrativaPorMedicao(perfil: Perfil, tecnico: DadosTecnicos, visual: MedicaoVisual, audio: MedicaoAudio | null, fala: Transcricao | null): AnaliseNarrativa {
  const estrutura = estruturaNarrativa(perfil, tecnico);
  const duracao = tecnico.duracaoSeg;
  const ritmo = visual.ritmo.valor;
  const curva = audio?.curvaDeIntensidadeDb ?? [];
  const semModelo = <T>() => naoAvaliado<T>(SEM_MODELO_DE_TEXTO);
  const foraDoFormato = <T>() => naoAplicavel<T>("estrutura de vídeo curto de divulgação não se aplica a este formato");

  // Abertura: os 3 primeiros segundos comparados com o restante do vídeo.
  const cortesNaAbertura = visual.cortesSeg.filter((t) => t <= 3).length;
  const ritmoNaAbertura = (cortesNaAbertura / Math.min(3, duracao)) * 60;
  const volumeNaAbertura = curva.slice(0, 3).reduce((s, v) => s + v, 0) / Math.max(1, Math.min(3, curva.length));
  const volumeMedio = curva.reduce((s, v) => s + v, 0) / Math.max(1, curva.length);
  const falaNaAbertura = fala?.segmentos.some((s) => s.inicioSeg <= 3) ?? false;
  const marcas = [
    ritmo && ritmoNaAbertura > ritmo.cortesPorMinuto * 1.2 ? "cortes mais rápidos que a média" : "",
    curva.length && volumeNaAbertura >= volumeMedio ? "áudio em volume igual ou acima da média" : "",
    falaNaAbertura ? "fala logo no início" : "",
  ].filter(Boolean);
  const hook: Caracteristica<ElementoNarrativo> =
    estrutura === "livre"
      ? foraDoFormato()
      : marcas.length
        ? estimado({ descricao: `Abertura com ${marcas.join(", ")}.`, inicioSeg: 0 }, "comparação dos 3 primeiros segundos com o restante do vídeo", 0.3 + 0.1 * marcas.length)
        : estimado({ descricao: "Abertura sem destaque de ritmo, volume ou fala em relação ao restante.", inicioSeg: 0 }, "comparação dos 3 primeiros segundos com o restante do vídeo", 0.3);

  // Clímax: a janela de 5 s que mais combina volume alto e muitos cortes.
  let climax: Caracteristica<ElementoNarrativo> = naoAvaliado("sem variação suficiente de volume e de ritmo para apontar um ápice");
  if (duracao >= 15 && curva.length >= 10) {
    const janelas = Array.from({ length: Math.max(1, Math.floor(duracao / 5)) }, (_, k) => ({
      inicio: k * 5,
      cortes: visual.cortesSeg.filter((t) => t >= k * 5 && t < k * 5 + 5).length,
      volume: curva.slice(k * 5, k * 5 + 5).reduce((s, v) => s + v, 0) / Math.max(1, curva.slice(k * 5, k * 5 + 5).length),
    }));
    const z = (valores: number[]) => {
      const media = valores.reduce((s, v) => s + v, 0) / valores.length;
      const desvio = Math.sqrt(valores.reduce((s, v) => s + (v - media) ** 2, 0) / valores.length) || 1;
      return valores.map((v) => (v - media) / desvio);
    };
    const zc = z(janelas.map((j) => j.cortes)), zv = z(janelas.map((j) => j.volume));
    const notas = janelas.map((_, k) => zc[k] + zv[k]);
    const melhor = notas.indexOf(Math.max(...notas));
    if (notas[melhor] >= 1.5) {
      climax = estimado({ descricao: `Trecho de maior intensidade combinada de cortes e volume, por volta de ${janelas[melhor].inicio} s.`, inicioSeg: janelas[melhor].inicio }, "janela de 5 s com mais cortes e maior volume", 0.35);
    }
  }

  const destaques = (audio?.mudancasDeIntensidade.valor ?? []).filter((m) => m.tipo === "aumento").slice(0, 5);
  const fadeFinal = visual.transicoes.some((t) => t.tipo === "fade-preto" && t.tempoSeg >= duracao * 0.85);
  const quedaFinal = curva.length >= 6 && curva.at(-1)! < volumeMedio - 8;
  const fim = [fadeFinal ? "fade para preto" : "", quedaFinal ? "áudio diminuindo" : ""].filter(Boolean);

  // CTA: palavras de chamada para ação ditas no último quinto do vídeo.
  const palavras = perfil.analise?.palavrasDeCta ?? [];
  const chamada = fala?.segmentos.find((s) => s.fimSeg >= duracao * 0.8 && palavras.some((p) => s.texto.toLowerCase().includes(p)));
  const cta: Caracteristica<ElementoNarrativo> = chamada
    ? estimado({ descricao: `Chamada falada no final: "${chamada.texto}"`, inicioSeg: chamada.inicioSeg }, "palavras de chamada para ação na transcrição do trecho final", 0.5)
    : estrutura === "livre"
      ? foraDoFormato()
      : naoAvaliado("nenhuma chamada falada encontrada; chamadas em texto na tela exigem modelo visual");

  return {
    estrutura,
    hook,
    desenvolvimento: semModelo(),
    progressao: ritmo
      ? estimado(
          { descricao: `Ritmo de cortes ${ritmo.progressao === "constante" ? "constante" : ritmo.progressao === "acelera" ? "crescente" : "decrescente"} ao longo do vídeo (${ritmo.porTerco.join(" → ")} cortes por minuto em cada terço).` },
          "cortes por minuto em cada terço do vídeo", 0.5,
        )
      : semModelo(),
    destaques: destaques.length
      ? estimado(destaques.map((m) => ({ descricao: `Aumento de ${m.variacaoDb} dB no volume.`, inicioSeg: m.tempoSeg })), "aumentos bruscos de volume", 0.4)
      : naoAvaliado("sem aumentos bruscos de volume; destaques visuais exigem modelo"),
    suspense: semModelo(),
    humor: semModelo(),
    emocao: semModelo(),
    climax,
    encerramento: fim.length
      ? estimado({ descricao: `Encerra com ${fim.join(" e ")}.`, inicioSeg: Math.round(duracao * 0.85) }, "transições e volume no trecho final", 0.6)
      : estimado({ descricao: "Encerra em corte, sem fade de imagem nem de áudio.", inicioSeg: Math.round(duracao * 0.85) }, "transições e volume no trecho final", 0.45),
    cta,
  };
}

/** Extrai o primeiro objeto JSON de uma resposta de modelo. */
function lerJson(texto: string): Record<string, unknown> | null {
  const inicio = texto.indexOf("{"), fim = texto.lastIndexOf("}");
  if (inicio < 0 || fim <= inicio) return null;
  try {
    return JSON.parse(texto.slice(inicio, fim + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const texto = (valor: unknown): string | null => (typeof valor === "string" && valor.trim() ? valor.trim() : null);

export type LeituraVisual = Pick<AnaliseVisual, "enquadramentos" | "efeitos" | "tipografia" | "legendas" | "animacoes">;

/** Enquadramento, efeitos, tipografia, legendas e animações: só um modelo visual consegue avaliar. */
export async function leituraVisualPorModelo(provedores: SeletorDeProvedores | undefined, quadros: () => Promise<string[]>, limitacoes: string[], modelos: string[]): Promise<LeituraVisual> {
  const vazio = (): LeituraVisual => ({
    enquadramentos: naoAvaliado(SEM_MODELO_VISUAL), efeitos: naoAvaliado(SEM_MODELO_VISUAL), tipografia: naoAvaliado(SEM_MODELO_VISUAL),
    legendas: naoAvaliado(SEM_MODELO_VISUAL), animacoes: naoAvaliado(SEM_MODELO_VISUAL),
  });
  let provedor: ProvedorIA;
  try {
    provedor = await (provedores?.selecionar("visao") ?? Promise.reject(new Error("sem provedores")));
  } catch {
    limitacoes.push("Enquadramentos, efeitos, tipografia, legendas na imagem e animações não foram avaliados: nenhum modelo visual disponível. Instale a IA local em Configurações para avaliar.");
    return vazio();
  }
  try {
    const resposta = await provedor.descreverImagens!({
      imagens: await quadros(),
      instrucao:
        "As imagens são quadros de um mesmo vídeo, em ordem. Descreva COMO o vídeo foi produzido, não o assunto. " +
        'Responda somente com JSON: {"enquadramentos": "...", "efeitos": "...", "tipografia": "...", "legendas": "...", "animacoes": "..."}. ' +
        'Use frases curtas em português. Quando algo não aparecer nos quadros, escreva "não observado".',
    });
    const dados = lerJson(resposta);
    if (!dados) throw new Error("resposta sem JSON");
    modelos.push(`${provedor.id}${provedor.modelo ? ` (${provedor.modelo})` : ""}: leitura visual`);
    const metodo = `modelo visual "${provedor.id}" sobre os quadros-chave`;
    const campo = (nome: string): Caracteristica<string> => {
      const valor = texto(dados[nome]);
      return valor ? estimado(valor, metodo, 0.6) : naoAvaliado("o modelo visual não respondeu a este item");
    };
    return { enquadramentos: campo("enquadramentos"), efeitos: campo("efeitos"), tipografia: campo("tipografia"), legendas: campo("legendas"), animacoes: campo("animacoes") };
  } catch (erro) {
    limitacoes.push(`A leitura por modelo visual falhou (${erro instanceof Error ? erro.message : erro}); os itens visuais interpretativos ficaram sem avaliação.`);
    return vazio();
  }
}

/** Completa a narrativa e sugere regras com um modelo de linguagem, se houver. Devolve as regras sugeridas. */
export async function narrativaPorModelo(
  provedores: SeletorDeProvedores | undefined, narrativa: AnaliseNarrativa, resumo: Record<string, unknown>, limitacoes: string[], modelos: string[],
): Promise<RegraDeEdicao[]> {
  let provedor: ProvedorIA;
  try {
    provedor = await (provedores?.selecionar("texto") ?? Promise.reject(new Error("sem provedores")));
  } catch {
    limitacoes.push("Desenvolvimento, suspense, humor e emoção não foram avaliados: nenhum modelo de linguagem disponível. Instale a IA local em Configurações para avaliar.");
    return [];
  }
  const itens = ["hook", "desenvolvimento", "progressao", "suspense", "humor", "emocao", "climax", "encerramento", "cta"] as const;
  try {
    const resposta = await provedor.gerarTexto!({
      sistema:
        "Você analisa como um vídeo foi editado, a partir de medições técnicas e da transcrição. Não invente o que os dados não sustentam. " +
        (narrativa.estrutura === "livre"
          ? "Este vídeo não é uma peça curta de divulgação: não procure gancho nem chamada para ação se não existirem."
          : "Este é um vídeo curto de divulgação: avalie o gancho inicial e a chamada para ação."),
      mensagem:
        `Dados do vídeo:\n${JSON.stringify(resumo)}\n\nResponda somente com JSON no formato ` +
        `{"narrativa": {${itens.map((i) => `"${i}": {"presente": true, "descricao": "...", "inicioSeg": 0}`).join(", ")}}, ` +
        `"regras": [{"categoria": "uma de: ${CATEGORIAS_EDICAO.join(", ")}", "chave": "identificador-curto", "valor": "faixa-curta", "descricao": "princípio aplicável a outros vídeos", "exemplo": "como aplicar"}]}. ` +
        'Em "regras", descreva princípios reutilizáveis, nunca a cópia deste vídeo. Use "presente": false quando o elemento não existir.',
    });
    const dados = lerJson(resposta);
    const lida = dados?.narrativa as Record<string, { presente?: boolean; descricao?: string; inicioSeg?: number }> | undefined;
    if (!lida) throw new Error("resposta sem JSON");
    modelos.push(`${provedor.id}${provedor.modelo ? ` (${provedor.modelo})` : ""}: leitura narrativa`);
    const metodo = `modelo de linguagem "${provedor.id}" sobre as medições e a transcrição`;
    for (const item of itens) {
      const lido = lida[item];
      const descricao = texto(lido?.descricao);
      if (!lido || !descricao) continue;
      // Elemento ausente em formato livre continua "não aplicável"; não se força a estrutura.
      if (lido.presente === false) {
        if (narrativa[item].base === "nao-avaliado") narrativa[item] = estimado({ descricao: `Ausente: ${descricao}` }, metodo, 0.5);
        continue;
      }
      narrativa[item] = estimado({ descricao, ...(typeof lido.inicioSeg === "number" ? { inicioSeg: lido.inicioSeg } : {}) }, metodo, 0.6);
    }
    const sugeridas = Array.isArray(dados?.regras) ? (dados.regras as Record<string, unknown>[]) : [];
    return sugeridas.flatMap((r) => {
      const categoria = texto(r.categoria), chave = texto(r.chave), valor = texto(r.valor), descricao = texto(r.descricao);
      if (!categoria || !chave || !valor || !descricao || !CATEGORIAS_EDICAO.includes(categoria as CategoriaEdicao)) return [];
      return [{ categoria: categoria as CategoriaEdicao, chave, valor, descricao, exemplo: texto(r.exemplo) ?? "", base: "estimado" as const, confianca: 0.45 }];
    });
  } catch (erro) {
    limitacoes.push(`A leitura narrativa por modelo de linguagem falhou (${erro instanceof Error ? erro.message : erro}).`);
    return [];
  }
}
