// Comparação entre versões de uma timeline e dedução das correções manuais do usuário.
// Funções puras: só leem timelines.

import type { Comparacao, Indicadores } from "../dominio/feedback.ts";
import type { CategoriaEdicao } from "../dominio/memoria.ts";
import type { ItemDaTimeline, ItemVideo, Timeline } from "../dominio/timeline.ts";
import { faixaPrincipal } from "./timeline.ts";

const arredondar = (n: number) => Math.round(n * 100) / 100;

/** Resume uma timeline em números comparáveis. */
export function indicadores(t: Timeline): Indicadores {
  const principal = faixaPrincipal(t);
  const clipes = principal.filter((i): i is ItemVideo => i.tipo === "video");
  const duracoes = clipes.map((c) => c.duracaoSeg).sort((a, b) => a - b);
  const mediana = duracoes.length ? (duracoes.length % 2 ? duracoes[duracoes.length >> 1] : (duracoes[(duracoes.length >> 1) - 1] + duracoes[duracoes.length >> 1]) / 2) : 0;
  const tempoDosClipes = clipes.reduce((s, c) => s + c.duracaoSeg, 0);
  const trocas = principal.slice(1);
  const cores = clipes.flatMap((c) => c.efeitos.filter((e) => e.tipo === "cor"));
  const modos = new Set(clipes.map((c) => c.enquadramento.modo));
  const legendas = t.itens.filter((i) => i.tipo === "legenda");
  const textos = t.itens.filter((i): i is Extract<ItemDaTimeline, { tipo: "texto" }> => i.tipo === "texto" && i.id !== "texto-cta");
  const trilha = t.itens.find((i): i is Extract<ItemDaTimeline, { tipo: "audio" }> => i.tipo === "audio" && i.papel === "trilha");
  const ultimo = principal.at(-1);
  const posicoes = textos.map((x) => x.posicao);
  const maisComum = (["topo", "centro", "base"] as const).map((p) => [p, posicoes.filter((x) => x === p).length] as const).sort((a, b) => b[1] - a[1])[0];
  return {
    duracaoSeg: t.duracaoSeg,
    clipes: clipes.length,
    duracaoMedianaDosPlanosSeg: arredondar(mediana),
    cortesPorMinuto: tempoDosClipes > 0 ? arredondar((Math.max(0, clipes.length - 1) / tempoDosClipes) * 60) : 0,
    transicoesGraduais: trocas.length ? arredondar(trocas.filter((i) => i.entrada.tipo === "gradual").length / trocas.length) : 0,
    clipesComCor: clipes.filter((c) => c.efeitos.some((e) => e.tipo === "cor")).length,
    saturacaoMedia: cores.length ? arredondar(cores.reduce((s, e) => s + (e.tipo === "cor" ? e.saturacao : 1), 0) / cores.length) : 1,
    clipesComZoom: clipes.filter((c) => c.efeitos.some((e) => e.tipo === "zoom-lento") || c.enquadramento.zoom > 1.05).length,
    barrasDeCinema: t.efeitosGlobais.some((e) => e.tipo === "barras-de-cinema"),
    enquadramento: modos.size > 1 ? "misto" : (clipes[0]?.enquadramento.modo ?? "preencher"),
    legendas: legendas.length,
    tamanhoDasLegendas: t.legendas.tamanho,
    legendasComCaixa: t.legendas.caixa,
    textos: textos.length,
    posicaoDosTextos: maisComum && maisComum[1] > 0 ? maisComum[0] : null,
    temTrilha: Boolean(trilha),
    volumeDaTrilha: trilha ? trilha.volume : null,
    efeitosSonoros: t.itens.filter((i) => i.tipo === "audio" && i.papel === "efeito-sonoro").length,
    encerramento: ultimo && "saida" in ultimo && ultimo.saida.tipo === "fade" ? "fade" : "corte",
    cta: t.itens.some((i) => i.tipo === "cartao") ? "cartao" : t.itens.some((i) => i.id === "texto-cta") ? "texto" : "nenhum",
  };
}

const ROTULOS: Partial<Record<keyof Indicadores, string>> = {
  duracaoSeg: "Duração do vídeo (s)", clipes: "Número de clipes", duracaoMedianaDosPlanosSeg: "Duração mediana dos planos (s)", cortesPorMinuto: "Cortes por minuto",
  transicoesGraduais: "Fração de transições graduais", clipesComCor: "Clipes com correção de cor", clipesComZoom: "Clipes com zoom", barrasDeCinema: "Barras de cinema",
  enquadramento: "Enquadramento", legendas: "Legendas", tamanhoDasLegendas: "Tamanho das legendas", textos: "Textos na tela", posicaoDosTextos: "Posição dos textos",
  temTrilha: "Trilha sonora", volumeDaTrilha: "Volume da trilha", efeitosSonoros: "Efeitos sonoros", encerramento: "Encerramento", cta: "Chamada para ação",
};

/** Compara duas versões: o que entrou, o que saiu, o que mudou em cada item e nos indicadores. */
export function compararTimelines(projetoId: string, de: { versao: number; timeline: Timeline }, para: { versao: number; timeline: Timeline }): Comparacao {
  const antes = new Map(de.timeline.itens.map((i) => [i.id, i]));
  const depois = new Map(para.timeline.itens.map((i) => [i.id, i]));
  const alterados: Comparacao["itens"]["alterados"] = [];
  for (const [id, item] of depois) {
    const anterior = antes.get(id) as unknown as Record<string, unknown> | undefined;
    if (!anterior) continue;
    const atual = item as unknown as Record<string, unknown>;
    const campos = [...new Set([...Object.keys(anterior), ...Object.keys(atual)])]
      .filter((campo) => JSON.stringify(anterior[campo]) !== JSON.stringify(atual[campo]))
      .map((campo) => ({ campo, de: anterior[campo], para: atual[campo] }));
    if (campos.length) alterados.push({ id, tipo: item.tipo, campos });
  }
  const a = indicadores(de.timeline), b = indicadores(para.timeline);
  const resumo = (Object.keys(ROTULOS) as (keyof Indicadores)[])
    .filter((chave) => a[chave] !== b[chave])
    .map((chave) => `${ROTULOS[chave]}: ${String(a[chave])} → ${String(b[chave])}`);
  const formato = (t: Timeline) => `${t.formato.largura}×${t.formato.altura} a ${t.formato.fps} quadros/s`;
  if (formato(de.timeline) !== formato(para.timeline)) resumo.unshift(`Formato: ${formato(de.timeline)} → ${formato(para.timeline)}`);
  return {
    projetoId, de: de.versao, para: para.versao, indicadores: { de: a, para: b },
    itens: {
      adicionados: [...depois.values()].filter((i) => !antes.has(i.id)).map((i) => ({ id: i.id, tipo: i.tipo })),
      removidos: [...antes.values()].filter((i) => !depois.has(i.id)).map((i) => ({ id: i.id, tipo: i.tipo })),
      alterados,
    },
    resumo,
  };
}

export interface CorrecaoDeduzida {
  categoria: CategoriaEdicao;
  chave: string;
  valor: string;
  descricao: string;
}

// Faixas qualitativas: as mesmas usadas pela análise de referências, pelo planejamento e pela montagem.
const faixas = {
  duracao: (s: number) => (s < 1.5 ? "curta" : s <= 4 ? "media" : "longa"),
  cadencia: (c: number) => (c >= 30 ? "rapido" : c >= 12 ? "moderado" : "lento"),
  transicao: (f: number) => (f >= 0.5 ? "gradual" : f >= 0.2 ? "misto" : "corte-seco"),
  saturacao: (i: Indicadores) => (i.clipesComCor === 0 || Math.abs(i.saturacaoMedia - 1) < 0.05 ? "media" : i.saturacaoMedia > 1 ? "alta" : "baixa"),
  zoom: (i: Indicadores) => { const f = i.clipes ? i.clipesComZoom / i.clipes : 0; return f >= 0.5 ? "frequente" : f >= 0.15 ? "ocasional" : "raro"; },
  legenda: (t: number) => (t < 0.03 ? "pequena" : t <= 0.038 ? "media" : "grande"),
  volume: (v: number) => (v < 0.4 ? "baixo" : v <= 0.75 ? "medio" : "alto"),
};

/**
 * Deduz, das diferenças entre a versão montada pela IA e a versão que o usuário aprovou,
 * o que ele corrigiu à mão. Só vira correção o que mudou de faixa: um ajuste pequeno, dentro
 * da mesma faixa, não ensina nada.
 */
export function deduzirCorrecoes(daIA: Timeline, doUsuario: Timeline): CorrecaoDeduzida[] {
  const a = indicadores(daIA), b = indicadores(doUsuario);
  const correcoes: CorrecaoDeduzida[] = [];
  const comparar = (categoria: CategoriaEdicao, chave: string, antes: string, depois: string, descricao: string) => {
    if (antes !== depois) correcoes.push({ categoria, chave, valor: depois, descricao: `${descricao} (a IA havia proposto "${antes}"; o usuário deixou "${depois}").` });
  };
  if (a.clipes >= 2 && b.clipes >= 2) {
    comparar("duracao-planos", "duracao-tipica", faixas.duracao(a.duracaoMedianaDosPlanosSeg), faixas.duracao(b.duracaoMedianaDosPlanosSeg), "Duração dos planos ajustada");
    comparar("ritmo", "cadencia-de-cortes", faixas.cadencia(a.cortesPorMinuto), faixas.cadencia(b.cortesPorMinuto), "Ritmo de cortes ajustado");
    comparar("transicoes", "tipo-predominante", faixas.transicao(a.transicoesGraduais), faixas.transicao(b.transicoesGraduais), "Tipo de transição trocado");
  }
  comparar("transicoes", "encerramento", a.encerramento === "fade" ? "fade-preto" : "corte", b.encerramento === "fade" ? "fade-preto" : "corte", "Encerramento trocado");
  comparar("cores", "saturacao", faixas.saturacao(a), faixas.saturacao(b), "Correção de cor ajustada");
  comparar("zoom", "uso", faixas.zoom(a), faixas.zoom(b), "Uso de zoom ajustado");
  comparar("efeitos-visuais", "barras-de-cinema", a.barrasDeCinema ? "sim" : "nao", b.barrasDeCinema ? "sim" : "nao", "Barras de cinema");
  if (a.enquadramento !== "misto" && b.enquadramento !== "misto") comparar("enquadramento", "modo", a.enquadramento, b.enquadramento, "Enquadramento trocado");
  if (a.legendas > 0 || b.legendas > 0) {
    comparar("legendas", "uso", a.legendas > 0 ? "sim" : "nao", b.legendas > 0 ? "sim" : "nao", "Uso de legendas");
    if (b.legendas > 0) {
      comparar("legendas", "tamanho", faixas.legenda(a.tamanhoDasLegendas), faixas.legenda(b.tamanhoDasLegendas), "Tamanho das legendas ajustado");
      comparar("legendas", "caixa", a.legendasComCaixa ? "sim" : "nao", b.legendasComCaixa ? "sim" : "nao", "Caixa atrás das legendas");
    }
  }
  if (a.posicaoDosTextos && b.posicaoDosTextos) comparar("tipografia", "posicao-do-texto", a.posicaoDosTextos, b.posicaoDosTextos, "Posição dos textos trocada");
  if (a.volumeDaTrilha !== null && b.volumeDaTrilha !== null) comparar("trilha-sonora", "volume", faixas.volume(a.volumeDaTrilha), faixas.volume(b.volumeDaTrilha), "Volume da trilha ajustado");
  if (a.cta !== "nenhum" && b.cta !== "nenhum") comparar("cta", "formato", a.cta, b.cta, "Formato da chamada para ação trocado");
  return correcoes;
}
