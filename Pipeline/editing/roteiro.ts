// Agente de Roteiro: escreve o roteiro de um plano de edição cena por cena, na ordem do
// vídeo, usando apenas fatos verificáveis — o que o usuário informou no briefing, o que foi
// dito nos vídeos e o que a análise viu em cada trecho. Nada fora dessa lista entra no texto.

import type { Agente, Bloco, Briefing, DescricaoDaCena, Fato, LinhaDoRoteiro, PlanoDeEdicao, Roteiro } from "../../src/dominio/producao.ts";
import type { ProvedorIA } from "../../src/dominio/provedores.ts";
import type { Perfil } from "../../src/dominio/tipos.ts";
import type { SeletorDeProvedores } from "../analysis/interpretacao.ts";

/** Aberturas genéricas que o roteiro não deve usar. */
const ABERTURA_GENERICA = /^\s*(ol[áa]|oi+|e a[íi]|fala(,)? (galera|pessoal)|bem[- ]vind|sejam bem|neste v[íi]deo|hoje (eu|n[óo]s|vamos|a gente)|voc[êe] j[áa] (se perguntou|imaginou)|nesse v[íi]deo)/i;
/** Palavras de chamada para ação: só podem aparecer se o usuário informou a chamada. */
const PALAVRAS_DE_CTA = /\b(inscreva|siga|acesse|entre no|entrem|clique|link na bio|discord|baixe|compre|garanta|cadastre)\b/i;
const NOMES_DOS_BLOCOS: Record<Bloco, string> = { abertura: "abertura", desenvolvimento: "desenvolvimento", climax: "clímax", encerramento: "encerramento" };

export interface EntradaDoRoteiro {
  projetoId: string;
  perfil: Perfil;
  briefing: Briefing;
  plano: PlanoDeEdicao;
  /** O que a análise viu em cada trecho do plano. Sem ela, só o que o plano registra. */
  cenas?: DescricaoDaCena[];
  provedores?: SeletorDeProvedores;
}

const tempo = (segundos: number): string => `${Math.floor(segundos / 60)}:${String(Math.floor(segundos % 60)).padStart(2, "0")}`;
const lista = (itens: string[]): string => (itens.length <= 1 ? (itens[0] ?? "") : `${itens.slice(0, -1).join(", ")} e ${itens.at(-1)}`);
const numeros = (texto: string): string[] => texto.match(/\d+(?:[.,]\d+)?/g) ?? [];

/** Descrição das cenas a partir só do plano (quando a análise do material não está disponível). */
export function cenasDoPlano(plano: PlanoDeEdicao): DescricaoDaCena[] {
  return plano.clipes.map((clipe, i) => {
    const fim = clipe.inicioLinhaDoTempoSeg + clipe.fimOrigemSeg - clipe.inicioOrigemSeg;
    return {
      n: i + 1, bloco: clipe.bloco, inicioSeg: clipe.inicioLinhaDoTempoSeg, fimSeg: fim, elementos: [], humor: false, ritmo: "movimentado" as const,
      falas: plano.legendas.itens.filter((f) => f.inicioSeg >= clipe.inicioLinhaDoTempoSeg && f.inicioSeg < fim).map((f) => f.texto),
    };
  });
}

export class AgenteDeRoteiro implements Agente {
  id = "roteiro";
  nome = "Agente de Roteiro";
  responsabilidade = "Escrever o roteiro do vídeo cena por cena, sem inventar falas, acontecimentos ou informações ausentes do material.";

  /** Fatos que o roteiro pode usar, cada um com um identificador. */
  fatos(briefing: Briefing, plano: PlanoDeEdicao, cenas: DescricaoDaCena[] = cenasDoPlano(plano)): Fato[] {
    const fatos: Fato[] = [];
    (briefing.fatos ?? []).forEach((texto, i) => fatos.push({ id: `B${i + 1}`, origem: "briefing", texto }));
    if (briefing.cta) fatos.push({ id: "CTA", origem: "briefing", texto: briefing.cta });
    plano.legendas.itens.forEach((fala, i) => fatos.push({ id: `F${i + 1}`, origem: "fala", texto: fala.texto }));
    for (const c of cenas) fatos.push({ id: `C${c.n}`, origem: "cena", texto: this.descrever(c) });
    return fatos;
  }

  /** A cena em uma frase legível: tempo, parte do vídeo, o que aparece, o que é falado e o ritmo. */
  private descrever(c: DescricaoDaCena): string {
    return [
      `${tempo(c.inicioSeg)}–${tempo(c.fimSeg)}, ${NOMES_DOS_BLOCOS[c.bloco]}`,
      c.elementos.length ? `aparecem ${lista(c.elementos.slice(0, 6))}` : "conteúdo visual não identificado",
      c.falas.length ? `fala: "${c.falas.join(" ").slice(0, 160)}"` : "sem fala",
      `ritmo ${c.ritmo}`,
      c.humor ? "tom de humor" : "",
    ].filter(Boolean).join("; ");
  }

  async escrever(e: EntradaDoRoteiro): Promise<Roteiro> {
    const cenas = e.cenas?.length ? e.cenas : cenasDoPlano(e.plano);
    const fatos = this.fatos(e.briefing, e.plano, cenas);
    const avisos: string[] = [];
    const estrutural = this.montarSemModelo(e, cenas, fatos);
    const roteiro: Roteiro = {
      projetoId: e.projetoId, base: "estrutura", angulos: e.perfil.angulosDeRoteiro ?? [], linhas: estrutural, fatos, avisos, criadoEm: new Date().toISOString(),
    };

    let provedor: ProvedorIA;
    try {
      provedor = await (e.provedores?.selecionar("texto") ?? Promise.reject(new Error("sem provedores")));
    } catch {
      avisos.push("Nenhum modelo de linguagem disponível: o roteiro é uma estrutura cena por cena com os fatos do material, sem texto de narração redigido. Instale a IA local em Configurações para ter a narração.");
      return roteiro;
    }
    try {
      const resposta = await provedor.gerarTexto!({ sistema: this.instrucoes(e), mensagem: this.pedido(e, cenas, fatos), temperatura: 0.4 });
      const inicio = resposta.indexOf("{"), fim = resposta.lastIndexOf("}");
      const dados = JSON.parse(resposta.slice(inicio, fim + 1)) as { ideia?: unknown; cenas?: { n?: unknown; narracao?: unknown; texto_na_tela?: unknown; fatos?: unknown }[] };
      if (!Array.isArray(dados.cenas)) throw new Error("resposta sem cenas");
      const linhas = this.conferir(dados.cenas, cenas, fatos, e, estrutural, avisos);
      if (!linhas.some((l) => l.tipo === "narracao")) throw new Error("nenhuma linha de narração passou na conferência");
      const ideia = typeof dados.ideia === "string" && dados.ideia.trim() && !numeros(dados.ideia).some((n) => !this.textoDosFatos(fatos).includes(n)) ? dados.ideia.trim().slice(0, 200) : undefined;
      return { ...roteiro, base: "modelo", ideia, linhas };
    } catch (erro) {
      avisos.push(`O texto do modelo de linguagem foi descartado (${erro instanceof Error ? erro.message : erro}); usada a estrutura cena por cena com os fatos do material.`);
      return roteiro;
    }
  }

  private textoDosFatos(fatos: Fato[]): string {
    return fatos.map((f) => f.texto).join(" ");
  }

  /** Roteiro sem modelo: o que mostrar em cada cena, na ordem, com as falas reais e os fatos do briefing distribuídos. */
  private montarSemModelo(e: EntradaDoRoteiro, cenas: DescricaoDaCena[], fatos: Fato[]): LinhaDoRoteiro[] {
    const linhas: LinhaDoRoteiro[] = [];
    const doBriefing = fatos.filter((f) => f.origem === "briefing" && f.id !== "CTA");
    // Cada fato informado aparece uma única vez, espalhado do começo ao fim (a primeira cena sempre leva um).
    // Com mais fatos que cenas, uma cena leva mais de um: nenhum fato fica de fora.
    const fatosDaCena = new Map<number, Fato[]>();
    doBriefing.forEach((fato, k) => {
      const posicao = Math.min(cenas.length - 1, Math.floor((k * cenas.length) / Math.max(1, doBriefing.length)));
      fatosDaCena.set(posicao, [...(fatosDaCena.get(posicao) ?? []), fato]);
    });
    const falasPorTexto = new Map(fatos.filter((f) => f.origem === "fala").map((f) => [f.texto, f.id]));
    cenas.forEach((c, i) => {
      const marca = { cena: c.n, inicioSeg: c.inicioSeg, fimSeg: c.fimSeg };
      const ritmo = c.ritmo === "intenso" ? ", com ação intensa" : c.ritmo === "movimentado" ? ", em movimento" : "";
      linhas.push({ bloco: c.bloco, tipo: "imagem", texto: `Mostrar ${c.elementos.length ? lista(c.elementos.slice(0, 4)) : "o trecho escolhido"}${ritmo}.`, baseadoEm: [`C${c.n}`], ...marca });
      for (const fala of c.falas) linhas.push({ bloco: c.bloco, tipo: "fala-original", texto: fala, baseadoEm: [falasPorTexto.get(fala) ?? `C${c.n}`, `C${c.n}`], ...marca });
      for (const fato of fatosDaCena.get(i) ?? []) linhas.push({ bloco: c.bloco, tipo: "texto-na-tela", texto: fato.texto, baseadoEm: [fato.id], ...marca });
    });
    const ultima = cenas.at(-1);
    if (e.plano.cta) linhas.push({ bloco: "encerramento", tipo: "texto-na-tela", texto: e.plano.cta.texto, baseadoEm: ["CTA"], ...(ultima ? { cena: ultima.n, inicioSeg: ultima.inicioSeg, fimSeg: ultima.fimSeg } : {}) });
    return linhas;
  }

  private instrucoes(e: EntradaDoRoteiro): string {
    return [
      "Você é roteirista de vídeos curtos e escreve em português do Brasil, em frases curtas e naturais, como se fala.",
      `Público: ${e.plano.publico || "geral"}. Plataforma: ${e.plano.plataforma || "não informada"}. Duração: cerca de ${Math.round(e.plano.duracaoPlanejadaSeg)} s.`,
      "O vídeo já está montado: as cenas vêm na ordem em que aparecem. Seu trabalho é escrever o que acompanha cada cena, na mesma ordem, formando uma história com começo, meio e fim.",
      "Regras: (1) use SOMENTE os fatos fornecidos; não invente funcionalidades, falas, acontecimentos, nomes, números ou datas;",
      "(2) a narração de cada cena deve combinar com o que aparece nela e continuar a ideia da cena anterior;",
      "(3) a primeira cena começa direto por algo concreto e chamativo do material, nunca por saudação ou frase genérica como \"neste vídeo\";",
      "(4) no máximo 14 palavras por narração; texto na tela com no máximo 6 palavras, só quando ajudar;",
      "(5) não repita ideias; (6) chamada para ação só na última cena e só se existir o fato CTA.",
      e.perfil.angulosDeRoteiro?.length ? `Ângulos que podem ser explorados, se os fatos sustentarem: ${e.perfil.angulosDeRoteiro.join(", ")}.` : "",
    ].filter(Boolean).join(" ");
  }

  private pedido(e: EntradaDoRoteiro, cenas: DescricaoDaCena[], fatos: Fato[]): string {
    const informados = fatos.filter((f) => f.origem === "briefing");
    return [
      `Objetivo do vídeo: ${e.briefing.objetivo}`,
      informados.length ? `Fatos informados pelo cliente:\n${informados.map((f) => `${f.id}: ${f.texto}`).join("\n")}` : "Nenhum fato informado pelo cliente.",
      `Cenas, na ordem do vídeo:\n${cenas.map((c) => `Cena ${c.n} — ${this.descrever(c)}`).join("\n")}`,
      "Primeiro escreva a ideia central do vídeo em uma frase. Depois, uma entrada para CADA cena, na ordem, sem pular nenhuma.",
      'Responda somente com JSON: {"ideia": "...", "cenas": [{"n": 1, "narracao": "...", "texto_na_tela": "", "fatos": ["B1"]}]}. ' +
        'Em "fatos", liste os fatos do cliente usados naquela cena (pode ficar vazio). Use "" quando não houver texto na tela.',
    ].join("\n\n");
  }

  /** Confere o texto do modelo cena por cena: descarta o que não tem base, repetições, números inventados, CTA inventado e abertura genérica. */
  private conferir(
    brutas: { n?: unknown; narracao?: unknown; texto_na_tela?: unknown; fatos?: unknown }[], cenas: DescricaoDaCena[], fatos: Fato[], e: EntradaDoRoteiro,
    estrutural: LinhaDoRoteiro[], avisos: string[],
  ): LinhaDoRoteiro[] {
    const conhecidos = new Set(fatos.map((f) => f.id));
    const baseDosNumeros = this.textoDosFatos(fatos);
    const porCena = new Map<number, (typeof brutas)[number]>();
    for (const bruta of brutas) if (Number.isInteger(Number(bruta.n)) && !porCena.has(Number(bruta.n))) porCena.set(Number(bruta.n), bruta);
    const vistas = new Set<string>();
    const linhas: LinhaDoRoteiro[] = [];
    let inventadas = 0, repetidas = 0, faltando = 0;
    const aceitavel = (texto: string, base: string[]): boolean => {
      if (numeros(texto).some((n) => !baseDosNumeros.includes(n))) return false; // número que não está em nenhum fato
      if (PALAVRAS_DE_CTA.test(texto) && !base.includes("CTA")) return false;
      return true;
    };
    for (const c of cenas) {
      const bruta = porCena.get(c.n);
      const marca = { cena: c.n, inicioSeg: c.inicioSeg, fimSeg: c.fimSeg };
      const usados = Array.isArray(bruta?.fatos) ? bruta.fatos.filter((id): id is string => typeof id === "string" && conhecidos.has(id) && id !== `C${c.n}`) : [];
      const base = [`C${c.n}`, ...usados];
      let narracao = typeof bruta?.narracao === "string" ? bruta.narracao.trim() : "";
      if (narracao && c.n === cenas[0]?.n && ABERTURA_GENERICA.test(narracao)) {
        avisos.push("A abertura escrita pelo modelo era genérica e foi substituída pelo que aparece na primeira cena.");
        narracao = "";
      }
      const chave = narracao.toLowerCase().replace(/[^a-zà-ú0-9 ]/gi, "");
      if (narracao && vistas.has(chave)) { repetidas += 1; narracao = ""; }
      if (narracao && !aceitavel(narracao, base)) { inventadas += 1; narracao = ""; }
      if (narracao) {
        vistas.add(chave);
        linhas.push({ bloco: c.bloco, tipo: "narracao", texto: narracao, baseadoEm: base, ...marca });
      } else {
        if (!bruta) faltando += 1;
        // Sem narração aproveitável, a cena fica com o que se sabe dela: o que mostrar e as falas reais.
        linhas.push(...estrutural.filter((l) => l.cena === c.n && l.tipo !== "texto-na-tela"));
      }
      const naTela = typeof bruta?.texto_na_tela === "string" ? bruta.texto_na_tela.trim() : "";
      if (naTela && naTela.split(/\s+/).length <= 8) {
        const chaveTela = naTela.toLowerCase();
        // Texto na tela precisa se apoiar num fato do cliente, não só na cena.
        if (usados.some((id) => id.startsWith("B")) && aceitavel(naTela, base) && !vistas.has(chaveTela)) {
          vistas.add(chaveTela);
          linhas.push({ bloco: c.bloco, tipo: "texto-na-tela", texto: naTela, baseadoEm: usados, ...marca });
        } else if (!usados.some((id) => id.startsWith("B")) || !aceitavel(naTela, base)) inventadas += 1;
      }
    }
    if (inventadas) avisos.push(`${inventadas} trecho(s) do modelo foram descartados por não se apoiarem em nenhum fato do material (números, chamadas para ação ou informações ausentes).`);
    if (repetidas) avisos.push(`${repetidas} linha(s) repetida(s) foram removidas.`);
    if (faltando) avisos.push(`O modelo não escreveu ${faltando} cena(s); elas ficaram com a descrição do que mostrar.`);
    // Fatos do cliente que o modelo não usou aparecem como texto na tela, uma vez cada.
    for (const linha of estrutural.filter((l) => l.tipo === "texto-na-tela" && !l.baseadoEm.includes("CTA"))) {
      if (!linhas.some((l) => l.baseadoEm.includes(linha.baseadoEm[0]))) linhas.push(linha);
    }
    if (e.plano.cta) linhas.push(estrutural.find((l) => l.baseadoEm.includes("CTA")) as LinhaDoRoteiro);
    // Ordem do vídeo: por cena e, dentro da cena, imagem, fala, narração e texto na tela.
    const ordemDoTipo = { imagem: 0, "fala-original": 1, narracao: 2, "texto-na-tela": 3 };
    return linhas
      .map((l, i) => ({ l, i }))
      .sort((a, b) => (a.l.baseadoEm.includes("CTA") ? 1 : 0) - (b.l.baseadoEm.includes("CTA") ? 1 : 0) || (a.l.cena ?? 0) - (b.l.cena ?? 0) || ordemDoTipo[a.l.tipo] - ordemDoTipo[b.l.tipo] || a.i - b.i)
      .map(({ l }) => l);
  }
}
