// Agente de Planejamento: escolhe os melhores trechos dos vídeos brutos e monta um plano
// de edição coerente com o objetivo, o perfil e o que a memória já aprendeu.
// Trabalha só com o que foi medido: não precisa de modelo de IA e não edita nada.

import type { Aprendizado } from "../../src/dominio/memoria.ts";
import type { AnaliseDeConteudo, ArquivoBruto, Agente, Bloco, Briefing, Clipe, Decisao, PlanoDeEdicao } from "../../src/dominio/producao.ts";
import type { FormatoSaida, Perfil } from "../../src/dominio/tipos.ts";

export interface Material {
  midiaId: string;
  arquivo: ArquivoBruto;
  conteudo: AnaliseDeConteudo;
}

export interface EntradaDoPlanejamento {
  perfil: Perfil;
  formato: FormatoSaida;
  briefing: Briefing;
  materiais: Material[];
  /** Aprendizados ativos que valem para o projeto. */
  aprendizados: Aprendizado[];
  /** Perfis de estilo das referências vinculadas ao projeto ("categoria/chave" → faixa). */
  estilosDeReferencia: Record<string, string>[];
  /** Duração de plano do estilo de edição escolhido no briefing, se houver. */
  duracaoDoPlanoDoEstilo?: number;
}

interface Candidato {
  midiaId: string;
  arquivo: string;
  inicioSeg: number;
  fimSeg: number;
  pontuacao: number;
  acao: number;
  temFala: boolean;
  motivo: string;
}

const arredondar = (n: number) => Math.round(n * 100) / 100;
const DURACAO_POR_FAIXA: Record<string, number> = { curta: 1.2, media: 2.5, longa: 5, rapido: 1.7, moderado: 3.5, lento: 6 };

export class AgenteDePlanejamento implements Agente {
  id = "planejamento";
  nome = "Agente de Planejamento";
  responsabilidade = "Propor o plano de edição: trechos, ordem, cortes, transições, áudio, legendas, efeitos, trilha e CTA.";

  planejar(e: EntradaDoPlanejamento): PlanoDeEdicao {
    const decisoes: Decisao[] = [];
    const avisos: string[] = [];

    // Preferência sobre um assunto: primeiro a memória, depois as referências do projeto.
    const preferencia = (categoria: string, chave: string): string | null => {
      const aprendido = e.aprendizados.find((a) => a.categoria === categoria && a.chave === chave);
      if (aprendido) {
        decisoes.push({ aspecto: `${categoria}/${chave}`, decisao: String(aprendido.valor), origem: "aprendizado", aprendizadoId: aprendido.id });
        return String(aprendido.valor);
      }
      const daReferencia = e.estilosDeReferencia.map((estilo) => estilo[`${categoria}/${chave}`]).find(Boolean);
      if (daReferencia) decisoes.push({ aspecto: `${categoria}/${chave}`, decisao: daReferencia, origem: "referencia" });
      return daReferencia ?? null;
    };

    const estrutura = e.perfil.analise?.estrutura === "livre" ? "livre" : e.perfil.analise?.estrutura === "curta" || e.formato.duracaoMaximaSeg ? "curta" : "livre";

    // --- Duração do vídeo e dos planos -------------------------------------------
    const duracaoDesejada = e.briefing.duracaoDesejadaSeg ?? (estrutura === "curta" ? Math.min(30, e.formato.duracaoMaximaSeg ?? 30) : 60);
    decisoes.push({ aspecto: "duracao", decisao: `${duracaoDesejada} s`, origem: e.briefing.duracaoDesejadaSeg ? "briefing" : "perfil" });
    const faixa = preferencia("duracao-planos", "duracao-tipica") ?? preferencia("ritmo", "cadencia-de-cortes");
    // Ordem de prioridade: o que a memória aprendeu, depois o estilo escolhido, depois o padrão do formato.
    const duracaoDoPlano = faixa && DURACAO_POR_FAIXA[faixa] ? DURACAO_POR_FAIXA[faixa] : (e.duracaoDoPlanoDoEstilo ?? (estrutura === "curta" ? 2 : 4));
    if (!faixa) decisoes.push({ aspecto: "duracao-dos-planos", decisao: `${duracaoDoPlano} s`, origem: e.duracaoDoPlanoDoEstilo ? "perfil" : "padrao" });

    // --- Candidatos: uma janela por cena aproveitável, e cada fala inteira ---------
    const candidatos: Candidato[] = [];
    // Arquivos com erros de decodificação ficam de fora: um trecho danificado estragaria o vídeo final.
    const danificados = e.materiais.filter((m) => m.arquivo.integridade !== "integro").map((m) => m.arquivo.nome);
    if (danificados.length) avisos.push(`Arquivos com erros ficaram fora do plano: ${danificados.join(", ")}.`);
    for (const { midiaId, arquivo, conteudo } of e.materiais) {
      if (arquivo.integridade !== "integro") continue;
      for (const cena of conteudo.cenas) {
        if (cena.etiquetas.some((etiqueta) => ["tela-preta", "imagem-parada", "imagem-escura"].includes(etiqueta))) continue;
        const duracao = Math.min(cena.duracaoSeg, duracaoDoPlano);
        if (duracao < 0.5) continue;
        const inicioSeg = arredondar(cena.inicioSeg + (cena.duracaoSeg - duracao) / 2);
        candidatos.push({
          midiaId, arquivo: arquivo.caminho, inicioSeg, fimSeg: arredondar(inicioSeg + duracao), pontuacao: cena.pontuacao, acao: cena.acao, temFala: false,
          motivo: cena.acao >= 0.35 ? `cena de ação (intensidade ${cena.acao})` : cena.etiquetas.includes("destaque") ? "destaque do material" : "cena de apoio",
        });
      }
      // Uma fala não é cortada no meio: entra inteira, até 3 vezes a duração de um plano.
      for (const fala of conteudo.transcricao?.segmentos ?? []) {
        const fimSeg = Math.min(fala.fimSeg, fala.inicioSeg + 3 * duracaoDoPlano);
        const cena = conteudo.cenas.find((c) => c.inicioSeg <= fala.inicioSeg && c.fimSeg > fala.inicioSeg);
        if (fimSeg - fala.inicioSeg < 0.5 || cena?.etiquetas.includes("tela-preta")) continue;
        candidatos.push({
          midiaId, arquivo: arquivo.caminho, inicioSeg: fala.inicioSeg, fimSeg: arredondar(fimSeg), pontuacao: Math.max(0.6, cena?.pontuacao ?? 0), acao: cena?.acao ?? 0,
          temFala: true, motivo: `fala: "${fala.texto.slice(0, 80)}"`,
        });
      }
    }

    // --- Seleção: os mais bem pontuados, sem sobreposição, até preencher a duração ---
    const escolhidos: Candidato[] = [];
    let duracaoEscolhida = 0;
    for (const candidato of [...candidatos].sort((a, b) => b.pontuacao - a.pontuacao)) {
      if (duracaoEscolhida >= duracaoDesejada) break;
      if (escolhidos.some((x) => x.midiaId === candidato.midiaId && x.inicioSeg < candidato.fimSeg && candidato.inicioSeg < x.fimSeg)) continue;
      const sobra = duracaoDesejada - duracaoEscolhida;
      const duracao = candidato.fimSeg - candidato.inicioSeg;
      if (duracao > sobra + 0.5 && !candidato.temFala) candidato.fimSeg = arredondar(candidato.inicioSeg + Math.max(0.5, sobra));
      escolhidos.push(candidato);
      duracaoEscolhida += candidato.fimSeg - candidato.inicioSeg;
    }
    if (escolhidos.length === 0) avisos.push("Nenhum trecho aproveitável foi encontrado nos vídeos brutos.");
    else if (duracaoEscolhida < duracaoDesejada * 0.6) avisos.push(`O material aproveitável rende ${arredondar(duracaoEscolhida)} s, menos que os ${duracaoDesejada} s desejados.`);

    // --- Ordem: cronológica; em vídeo curto, o melhor trecho abre e o segundo melhor faz o clímax ---
    const cronologica = [...escolhidos].sort((a, b) => a.arquivo.localeCompare(b.arquivo) || a.inicioSeg - b.inicioSeg);
    let ordem = cronologica;
    let climax: Candidato | null = null;
    if (estrutura === "curta" && escolhidos.length >= 4) {
      const [abertura, segundo] = escolhidos;
      const resto = cronologica.filter((c) => c !== abertura && c !== segundo);
      const posicao = Math.max(1, Math.min(resto.length - 1, Math.round(resto.length * 0.75)));
      ordem = [abertura, ...resto.slice(0, posicao), segundo, ...resto.slice(posicao)];
      climax = segundo;
      decisoes.push({ aspecto: "estrutura", decisao: "abre com o trecho mais forte (gancho) e guarda o segundo mais forte para o clímax", origem: "perfil" });
    } else {
      decisoes.push({ aspecto: "estrutura", decisao: "ordem cronológica do material", origem: estrutura === "livre" ? "perfil" : "padrao" });
    }

    // --- Transições -----------------------------------------------------------------
    const padrao = (preferencia("transicoes", "tipo-predominante") ?? "corte-seco") as PlanoDeEdicao["transicoes"]["padrao"];
    const encerramento = preferencia("transicoes", "encerramento") === "fade-preto" ? "fade-preto" : "corte";

    // --- Linha do tempo ---------------------------------------------------------------
    let tempo = 0;
    const clipes: Clipe[] = ordem.map((c, i) => {
      const bloco: Bloco = i === 0 ? "abertura" : i === ordem.length - 1 && ordem.length > 1 ? "encerramento" : c === climax ? "climax" : "desenvolvimento";
      const anterior: Bloco | null = i > 0 ? (i - 1 === 0 ? "abertura" : ordem[i - 1] === climax ? "climax" : "desenvolvimento") : null;
      const clipe: Clipe = {
        midiaId: c.midiaId, arquivo: c.arquivo, inicioOrigemSeg: c.inicioSeg, fimOrigemSeg: c.fimSeg, inicioLinhaDoTempoSeg: arredondar(tempo), bloco, motivo: c.motivo,
        transicaoDeEntrada: i === 0 ? "nenhuma" : padrao === "gradual" || (padrao === "misto" && bloco !== anterior) ? "gradual" : "corte-seco",
      };
      tempo += c.fimSeg - c.inicioSeg;
      return clipe;
    });
    const duracaoPlanejada = arredondar(tempo);

    const descricoes: Record<Bloco, string> = {
      abertura: estrutura === "curta" ? "Gancho: o trecho mais forte do material, para prender a atenção logo no início." : "Apresentação do tema com o primeiro trecho do material.",
      desenvolvimento: "Sequência dos trechos escolhidos, na ordem em que aconteceram.",
      climax: "Ponto alto: o segundo trecho mais forte, perto do final.",
      encerramento: "Fechamento do vídeo.",
    };
    const estruturaNarrativa = (["abertura", "desenvolvimento", "climax", "encerramento"] as Bloco[]).flatMap((bloco) => {
      const doBloco = clipes.filter((c) => c.bloco === bloco);
      if (doBloco.length === 0) return [];
      const ultimo = doBloco.at(-1)!;
      return [{ bloco, inicioSeg: doBloco[0].inicioLinhaDoTempoSeg, fimSeg: arredondar(ultimo.inicioLinhaDoTempoSeg + ultimo.fimOrigemSeg - ultimo.inicioOrigemSeg), descricao: descricoes[bloco] }];
    });

    // --- Áudio, legendas, trilha, efeitos e CTA -----------------------------------------
    const temFala = ordem.some((c) => c.temFala);
    const itensDeLegenda = clipes.flatMap((clipe) => {
      const conteudo = e.materiais.find((m) => m.midiaId === clipe.midiaId)?.conteudo;
      return (conteudo?.transcricao?.segmentos ?? [])
        .filter((s) => s.inicioSeg < clipe.fimOrigemSeg && s.fimSeg > clipe.inicioOrigemSeg)
        .map((s) => ({
          inicioSeg: arredondar(clipe.inicioLinhaDoTempoSeg + Math.max(0, s.inicioSeg - clipe.inicioOrigemSeg)),
          fimSeg: arredondar(clipe.inicioLinhaDoTempoSeg + Math.min(clipe.fimOrigemSeg, s.fimSeg) - clipe.inicioOrigemSeg),
          texto: s.texto,
        }));
    });
    const andamento = preferencia("trilha-sonora", "andamento");
    const naBatida = preferencia("sincronizacao-musical", "cortes-na-batida") === "sim";
    const efeitos: string[] = [];
    if (preferencia("efeitos-visuais", "barras-de-cinema") === "sim") efeitos.push("Barras de cinema em cima e embaixo.");
    const zoom = preferencia("zoom", "uso");
    if (zoom && zoom !== "raro") efeitos.push("Zoom lento em planos parados.");
    const saturacao = preferencia("cores", "saturacao");
    if (saturacao) efeitos.push(`Correção de cor com saturação ${saturacao}.`);

    const orientacao = e.formato.largura === e.formato.altura ? "quadrado" : e.formato.largura > e.formato.altura ? "horizontal" : "vertical";
    const diferentes = new Set(e.materiais.filter((m) => clipes.some((c) => c.midiaId === m.midiaId) && m.arquivo.tecnico && m.arquivo.tecnico.orientacao !== orientacao).map((m) => m.arquivo.nome));
    if (diferentes.size) avisos.push(`Arquivos em orientação diferente do formato ${orientacao} (${[...diferentes].join(", ")}): os trechos precisarão de recorte ou reenquadramento.`);

    let cta: PlanoDeEdicao["cta"] = null;
    if (e.briefing.cta) {
      cta = { texto: e.briefing.cta, inicioSeg: arredondar(Math.max(0, duracaoPlanejada - 3)) };
      decisoes.push({ aspecto: "cta", decisao: e.briefing.cta, origem: "briefing" });
    } else if (estrutura === "curta") {
      avisos.push("Nenhuma chamada para ação foi informada. Informe o texto do CTA no briefing para incluí-lo; nada é inventado.");
    }

    return {
      versao: 1,
      objetivo: e.briefing.objetivo,
      publico: e.briefing.publico ?? "não informado",
      plataforma: e.briefing.plataforma ?? e.formato.nome,
      formato: e.formato,
      duracaoDesejadaSeg: duracaoDesejada,
      duracaoPlanejadaSeg: duracaoPlanejada,
      estruturaNarrativa,
      clipes,
      transicoes: { padrao, encerramento },
      audio: temFala
        ? { audioOriginal: "manter", descricao: "Manter o áudio original nos trechos com fala e baixar a trilha durante as falas." }
        : { audioOriginal: "remover", descricao: "Sem falas nos trechos escolhidos: conduzir pelo som da trilha." },
      legendas: {
        ativas: itensDeLegenda.length > 0, itens: itensDeLegenda,
        observacao: itensDeLegenda.length ? "Legendas das falas, a partir da transcrição; revisar o texto antes de publicar." : "Sem falas nos trechos escolhidos.",
      },
      efeitos,
      trilhaSonora: {
        recomendada: true, andamento, sincronizarCortesComBatidas: naBatida, arquivo: null,
        observacao: `Escolher uma trilha${andamento ? ` de andamento ${andamento}` : ""}; nenhum arquivo de música foi definido.${naBatida ? " Ajustar os cortes às batidas depois de escolhida." : ""}`,
      },
      cta,
      decisoes,
      avisos,
    };
  }
}
