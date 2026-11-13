// Agente de Roteiro: escreve o roteiro de um plano de edição usando apenas fatos
// verificáveis — o que o usuário informou no briefing, o que foi dito nos vídeos e o que
// foi medido nas cenas. Nada fora dessa lista entra no texto.

import type { Agente, Bloco, Briefing, Fato, LinhaDoRoteiro, PlanoDeEdicao, Roteiro } from "../../src/dominio/producao.ts";
import type { ProvedorIA } from "../../src/dominio/provedores.ts";
import type { Perfil } from "../../src/dominio/tipos.ts";
import type { SeletorDeProvedores } from "../analysis/interpretacao.ts";

/** Aberturas genéricas que o roteiro não deve usar. */
const ABERTURA_GENERICA = /^\s*(ol[áa]|oi+|e a[íi]|fala(,)? (galera|pessoal)|bem[- ]vind|sejam bem|neste v[íi]deo|hoje (eu|n[óo]s|vamos|a gente)|voc[êe] j[áa] (se perguntou|imaginou)|nesse v[íi]deo)/i;
const BLOCOS: Bloco[] = ["abertura", "desenvolvimento", "climax", "encerramento"];

export interface EntradaDoRoteiro {
  projetoId: string;
  perfil: Perfil;
  briefing: Briefing;
  plano: PlanoDeEdicao;
  provedores?: SeletorDeProvedores;
}

export class AgenteDeRoteiro implements Agente {
  id = "roteiro";
  nome = "Agente de Roteiro";
  responsabilidade = "Escrever o roteiro do vídeo sem inventar falas, acontecimentos ou informações ausentes do material.";

  /** Fatos que o roteiro pode usar, cada um com um identificador. */
  fatos(briefing: Briefing, plano: PlanoDeEdicao): Fato[] {
    const fatos: Fato[] = [];
    (briefing.fatos ?? []).forEach((texto, i) => fatos.push({ id: `B${i + 1}`, origem: "briefing", texto }));
    if (briefing.cta) fatos.push({ id: "CTA", origem: "briefing", texto: briefing.cta });
    plano.legendas.itens.forEach((fala, i) => fatos.push({ id: `F${i + 1}`, origem: "fala", texto: fala.texto }));
    plano.clipes.forEach((clipe, i) => fatos.push({ id: `C${i + 1}`, origem: "cena", texto: `${clipe.bloco}: ${clipe.motivo}` }));
    return fatos;
  }

  async escrever(e: EntradaDoRoteiro): Promise<Roteiro> {
    const fatos = this.fatos(e.briefing, e.plano);
    const avisos: string[] = [];
    const estrutural = this.montarSemModelo(e, fatos);
    const roteiro: Roteiro = {
      projetoId: e.projetoId, base: "estrutura", angulos: e.perfil.angulosDeRoteiro ?? [], linhas: estrutural, fatos, avisos, criadoEm: new Date().toISOString(),
    };

    let provedor: ProvedorIA;
    try {
      provedor = await (e.provedores?.selecionar("texto") ?? Promise.reject(new Error("sem provedores")));
    } catch {
      avisos.push("Nenhum modelo de linguagem disponível: o roteiro é uma estrutura montada com os fatos do material, sem texto de narração redigido.");
      return roteiro;
    }
    try {
      const resposta = await provedor.gerarTexto!({ sistema: this.instrucoes(e), mensagem: this.pedido(e, fatos), temperatura: 0.6 });
      const inicio = resposta.indexOf("{"), fim = resposta.lastIndexOf("}");
      const dados = JSON.parse(resposta.slice(inicio, fim + 1)) as { linhas?: { bloco?: string; tipo?: string; texto?: string; baseadoEm?: unknown }[] };
      if (!Array.isArray(dados.linhas)) throw new Error("resposta sem linhas");
      const linhas = this.conferir(dados.linhas, fatos, e, estrutural, avisos);
      if (linhas.length === 0) throw new Error("nenhuma linha passou na conferência");
      return { ...roteiro, base: "modelo", linhas };
    } catch (erro) {
      avisos.push(`O texto do modelo de linguagem foi descartado (${erro instanceof Error ? erro.message : erro}); usada a estrutura montada com os fatos do material.`);
      return roteiro;
    }
  }

  /** Roteiro sem modelo: indica o que mostrar em cada bloco e reaproveita falas e fatos reais. */
  private montarSemModelo(e: EntradaDoRoteiro, fatos: Fato[]): LinhaDoRoteiro[] {
    const linhas: LinhaDoRoteiro[] = [];
    const usados = new Set<string>();
    const doBriefing = fatos.filter((f) => f.origem === "briefing" && f.id !== "CTA");
    const proximoFato = () => doBriefing.find((f) => !usados.has(f.id));

    e.plano.clipes.forEach((clipe, i) => {
      const cena = `C${i + 1}`;
      const fim = clipe.inicioLinhaDoTempoSeg + clipe.fimOrigemSeg - clipe.inicioOrigemSeg;
      const falas = e.plano.legendas.itens.map((fala, k) => ({ fala, id: `F${k + 1}` })).filter(({ fala }) => fala.inicioSeg >= clipe.inicioLinhaDoTempoSeg && fala.inicioSeg < fim);
      if (falas.length) {
        for (const { fala, id } of falas) linhas.push({ bloco: clipe.bloco, tipo: "fala-original", texto: fala.texto, baseadoEm: [id, cena] });
      } else {
        linhas.push({ bloco: clipe.bloco, tipo: "imagem", texto: `Mostrar ${clipe.motivo}.`, baseadoEm: [cena] });
      }
      // Cada fato informado pelo usuário aparece uma única vez, como texto na tela.
      const fato = clipe.bloco === "abertura" || clipe.bloco === "climax" || i % 3 === 0 ? proximoFato() : undefined;
      if (fato) {
        usados.add(fato.id);
        linhas.push({ bloco: clipe.bloco, tipo: "texto-na-tela", texto: fato.texto, baseadoEm: [fato.id] });
      }
    });
    if (e.plano.cta) linhas.push({ bloco: "encerramento", tipo: "texto-na-tela", texto: e.plano.cta.texto, baseadoEm: ["CTA"] });
    return linhas;
  }

  private instrucoes(e: EntradaDoRoteiro): string {
    return [
      "Você escreve roteiros curtos de vídeo em português do Brasil, em linguagem natural e falada.",
      `Público: ${e.plano.publico}. Plataforma: ${e.plano.plataforma}. Duração: cerca de ${Math.round(e.plano.duracaoPlanejadaSeg)} s.`,
      "Regras: (1) use SOMENTE os fatos numerados fornecidos; não invente funcionalidades, falas, acontecimentos, nomes, números ou datas;",
      "(2) comece direto por algo concreto e interessante do material, nunca por saudação ou frase genérica como \"neste vídeo\";",
      "(3) não repita a mesma ideia; (4) mantenha uma narrativa coerente do começo ao fim;",
      "(5) termine com a chamada para ação somente se existir o fato CTA; caso contrário, não crie nenhuma.",
      e.perfil.angulosDeRoteiro?.length ? `Ângulos que podem ser explorados, se os fatos sustentarem: ${e.perfil.angulosDeRoteiro.join(", ")}.` : "",
    ].filter(Boolean).join(" ");
  }

  private pedido(e: EntradaDoRoteiro, fatos: Fato[]): string {
    return (
      `Objetivo do vídeo: ${e.briefing.objetivo}\n\nFatos disponíveis:\n${fatos.map((f) => `${f.id} (${f.origem}): ${f.texto}`).join("\n")}\n\n` +
      'Responda somente com JSON: {"linhas": [{"bloco": "abertura|desenvolvimento|climax|encerramento", "tipo": "narracao|texto-na-tela", "texto": "...", "baseadoEm": ["B1", "C2"]}]}. ' +
      'Cada linha deve citar em "baseadoEm" os fatos que a sustentam.'
    );
  }

  /** Confere o texto do modelo: descarta linhas sem base, repetições, aberturas genéricas e CTA inventado. */
  private conferir(
    brutas: { bloco?: string; tipo?: string; texto?: string; baseadoEm?: unknown }[], fatos: Fato[], e: EntradaDoRoteiro, estrutural: LinhaDoRoteiro[], avisos: string[],
  ): LinhaDoRoteiro[] {
    const conhecidos = new Set(fatos.map((f) => f.id));
    const vistas = new Set<string>();
    const linhas: LinhaDoRoteiro[] = [];
    let semBase = 0, repetidas = 0;
    for (const bruta of brutas) {
      const texto = typeof bruta.texto === "string" ? bruta.texto.trim() : "";
      const base = Array.isArray(bruta.baseadoEm) ? bruta.baseadoEm.filter((id): id is string => typeof id === "string" && conhecidos.has(id)) : [];
      if (!texto || !BLOCOS.includes(bruta.bloco as Bloco)) continue;
      if (base.length === 0) { semBase += 1; continue; }
      // Chamada para ação só vale se o usuário a informou.
      if (bruta.bloco === "encerramento" && /\b(inscreva|siga|acesse|entre|clique|link|discord|baixe|compre)\b/i.test(texto) && !base.includes("CTA")) { semBase += 1; continue; }
      const chave = texto.toLowerCase().replace(/[^a-zà-ú0-9 ]/gi, "");
      if (vistas.has(chave)) { repetidas += 1; continue; }
      vistas.add(chave);
      linhas.push({ bloco: bruta.bloco as Bloco, tipo: bruta.tipo === "texto-na-tela" ? "texto-na-tela" : "narracao", texto, baseadoEm: base });
    }
    if (semBase) avisos.push(`${semBase} linha(s) do modelo foram descartadas por não se apoiarem em nenhum fato do material.`);
    if (repetidas) avisos.push(`${repetidas} linha(s) repetida(s) foram removidas.`);

    const abertura = linhas.find((l) => l.bloco === "abertura");
    if (abertura && ABERTURA_GENERICA.test(abertura.texto)) {
      const substituta = estrutural.find((l) => l.bloco === "abertura");
      linhas.splice(linhas.indexOf(abertura), 1, ...(substituta ? [substituta] : []));
      avisos.push("A abertura escrita pelo modelo era genérica e foi substituída pelo trecho mais forte do material.");
    }
    if (e.plano.cta && !linhas.some((l) => l.baseadoEm.includes("CTA"))) {
      linhas.push({ bloco: "encerramento", tipo: "texto-na-tela", texto: e.plano.cta.texto, baseadoEm: ["CTA"] });
    }
    return linhas.sort((a, b) => BLOCOS.indexOf(a.bloco) - BLOCOS.indexOf(b.bloco));
  }
}
