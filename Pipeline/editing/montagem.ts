// Agente de Edição: transforma um plano aprovado em timeline. Escolhe os recursos pelo
// contexto — estilo, memória, referências, formato e material — e registra o motivo de
// cada escolha. Não aplica um efeito só porque ele existe.

import type { Aprendizado } from "../../src/dominio/memoria.ts";
import type { Agente, Decisao, PlanoDeEdicao, Roteiro } from "../../src/dominio/producao.ts";
import type { Efeito, ItemDaTimeline, ItemVideo, Timeline } from "../../src/dominio/timeline.ts";
import type { EstiloDeEdicao } from "../../src/servicos/estilos.ts";
import type { Material } from "./planejamento.ts";

export interface EntradaDaMontagem {
  plano: PlanoDeEdicao;
  estilo: EstiloDeEdicao;
  materiais: Material[];
  aprendizados: Aprendizado[];
  estilosDeReferencia: Record<string, string>[];
  roteiro?: Roteiro;
  nomeDoProjeto: string;
}

export interface Montagem {
  timeline: Timeline;
  decisoes: Decisao[];
  avisos: string[];
}

const arredondar = (n: number) => Math.round(n * 1000) / 1000;
const CENTRO = { modo: "preencher" as const, x: 0.5, y: 0.5, zoom: 1 };

export class AgenteDeEdicao implements Agente {
  id = "edicao";
  nome = "Agente de Edição";
  responsabilidade = "Montar a timeline a partir do plano aprovado, escolhendo transições, efeitos, textos e áudio adequados ao contexto.";

  montar(e: EntradaDaMontagem): Montagem {
    const { plano, estilo } = e;
    const decisoes: Decisao[] = [];
    const avisos: string[] = [];
    const itens: ItemDaTimeline[] = [];

    // O que a memória ou as referências do projeto dizem sobre um assunto.
    const aprendido = (categoria: string, chave: string): string | null => {
      const a = e.aprendizados.find((x) => x.categoria === categoria && x.chave === chave);
      if (a) return String(a.valor);
      return e.estilosDeReferencia.map((r) => r[`${categoria}/${chave}`]).find(Boolean) ?? null;
    };
    const origemDe = (categoria: string, chave: string): Decisao["origem"] =>
      e.aprendizados.some((x) => x.categoria === categoria && x.chave === chave) ? "aprendizado" : "referencia";

    // --- Formato: mantém a taxa de quadros dos originais quando todos coincidem -----
    const usados = e.materiais.filter((m) => plano.clipes.some((c) => c.midiaId === m.midiaId));
    const taxas = [...new Set(usados.map((m) => Math.round(m.arquivo.tecnico?.fps ?? 0)).filter(Boolean))];
    const fps = taxas.length === 1 && taxas[0] >= 24 && taxas[0] <= 60 ? taxas[0] : plano.formato.fps;
    decisoes.push({
      aspecto: "taxa-de-quadros",
      decisao: taxas.length === 1 && fps === taxas[0] ? `${fps} quadros/s, igual à dos arquivos originais` : `${fps} quadros/s, do formato do projeto (os originais têm taxas diferentes: ${taxas.join(", ") || "desconhecidas"})`,
      origem: taxas.length === 1 && fps === taxas[0] ? "padrao" : "perfil",
    });
    const horizontal = plano.formato.largura > plano.formato.altura;

    // --- Transições: o que a memória ensinou vale mais que o estilo ------------------
    const transicaoAprendida = aprendido("transicoes", "tipo-predominante");
    const gradualPadrao = transicaoAprendida ? transicaoAprendida !== "corte-seco" : estilo.transicao.tipo === "gradual";
    const duracaoDaTransicao = estilo.transicao.duracaoSeg || 0.4;
    decisoes.push({
      aspecto: "transicoes", decisao: transicaoAprendida ?? estilo.transicao.tipo,
      origem: transicaoAprendida ? origemDe("transicoes", "tipo-predominante") : "perfil",
    });

    // --- Cor: uma única correção, da memória ou do estilo --------------------------------
    const saturacao = aprendido("cores", "saturacao");
    const corDoEstilo = estilo.efeitos.find((x): x is Extract<Efeito, { tipo: "cor" }> => x.tipo === "cor");
    let cor: Extract<Efeito, { tipo: "cor" }> | null = null;
    if (saturacao === "alta" || saturacao === "baixa") {
      cor = { tipo: "cor", saturacao: saturacao === "alta" ? 1.15 : 0.85, contraste: corDoEstilo?.contraste ?? 1, brilho: 1 };
      decisoes.push({ aspecto: "efeito/cor", decisao: `saturação ${saturacao}`, origem: origemDe("cores", "saturacao") });
    } else if (corDoEstilo) {
      cor = corDoEstilo;
      decisoes.push({ aspecto: "efeito/cor", decisao: `correção do estilo ${estilo.nome}`, origem: "perfil" });
    }

    // --- Zoom lento: só em planos parados, e só se o estilo ou a memória pedirem -------------
    const zoomAprendido = aprendido("zoom", "uso");
    const querZoom = estilo.zoomLentoEmPlanosParados || (zoomAprendido !== null && zoomAprendido !== "raro");

    const temTrilha = Boolean(plano.trilhaSonora.arquivo);
    const falas = plano.legendas.itens;
    let comZoom = 0;

    // --- Clipes da faixa principal -----------------------------------------------------------
    let tempo = 0;
    plano.clipes.forEach((clipe, i) => {
      const material = e.materiais.find((m) => m.midiaId === clipe.midiaId);
      const cena = material?.conteudo.cenas.find((c) => c.inicioSeg <= clipe.inicioOrigemSeg + 0.05 && c.fimSeg > clipe.inicioOrigemSeg + 0.05);
      const duracao = arredondar(clipe.fimOrigemSeg - clipe.inicioOrigemSeg);
      const fimNoPlano = clipe.inicioLinhaDoTempoSeg + duracao;
      const temFala = falas.some((f) => f.inicioSeg >= clipe.inicioLinhaDoTempoSeg - 0.01 && f.inicioSeg < fimNoPlano);
      const gradual = i > 0 && (clipe.transicaoDeEntrada === "gradual" || (clipe.transicaoDeEntrada === "corte-seco" && gradualPadrao && !transicaoAprendida));
      const efeitos: Efeito[] = cor ? [cor] : [];
      if (querZoom && cena?.movimento === "estatico" && duracao >= 1.5) {
        efeitos.push({ tipo: "zoom-lento", intensidade: 0.08 });
        comZoom += 1;
      }
      const sobreposicao = gradual ? Math.min(duracaoDaTransicao, duracao / 2) : 0;
      const item: ItemVideo = {
        id: `clipe-${i + 1}`, tipo: "video", camada: 0, inicioSeg: arredondar(tempo - sobreposicao), duracaoSeg: duracao,
        arquivo: clipe.arquivo, midiaId: clipe.midiaId, inicioOrigemSeg: clipe.inicioOrigemSeg, velocidade: 1,
        // Com trilha, só os trechos de fala mantêm o som original; sem trilha, o som original fica em tudo.
        volume: !temTrilha || temFala ? 1 : 0,
        enquadramento: { ...CENTRO }, entrada: gradual ? { tipo: "gradual", duracaoSeg: duracaoDaTransicao } : { tipo: "corte", duracaoSeg: 0 },
        saida: { tipo: "corte", duracaoSeg: 0 }, efeitos,
      };
      itens.push(item);
      tempo = item.inicioSeg + duracao;

      // Legendas das falas deste clipe, presas a ele.
      for (const fala of falas.filter((f) => f.inicioSeg >= clipe.inicioLinhaDoTempoSeg - 0.01 && f.inicioSeg < fimNoPlano)) {
        const deslocamento = arredondar(Math.max(0, fala.inicioSeg - clipe.inicioLinhaDoTempoSeg));
        itens.push({
          id: `legenda-${itens.filter((x) => x.tipo === "legenda").length + 1}`, tipo: "legenda", camada: 10, texto: fala.texto,
          inicioSeg: arredondar(item.inicioSeg + deslocamento), duracaoSeg: arredondar(Math.max(0.3, Math.min(fala.fimSeg - fala.inicioSeg, duracao - deslocamento))),
          ancora: { itemId: item.id, deslocamentoSeg: deslocamento },
        });
      }
    });
    const clipes = itens.filter((x): x is ItemVideo => x.tipo === "video");
    if (querZoom) {
      decisoes.push({
        aspecto: "efeito/zoom-lento", origem: estilo.zoomLentoEmPlanosParados ? "perfil" : origemDe("zoom", "uso"),
        decisao: comZoom ? `aplicado em ${comZoom} plano(s) parado(s)` : "não aplicado: nenhum plano parado entre os escolhidos",
      });
    }
    const orientacoes = new Set(usados.map((m) => m.arquivo.tecnico?.orientacao));
    if ([...orientacoes].some((o) => o && o !== (horizontal ? "horizontal" : plano.formato.largura === plano.formato.altura ? "quadrado" : "vertical"))) {
      decisoes.push({ aspecto: "enquadramento", decisao: "recorte central para preencher o quadro; ajustável clipe a clipe", origem: "padrao" });
    }

    // --- Barras de cinema: só fazem sentido em formato horizontal -------------------------------
    const efeitosGlobais: Efeito[] = [];
    const barrasDoEstilo = estilo.efeitos.find((x): x is Extract<Efeito, { tipo: "barras-de-cinema" }> => x.tipo === "barras-de-cinema");
    const barrasAprendidas = aprendido("efeitos-visuais", "barras-de-cinema") === "sim";
    if (barrasDoEstilo || barrasAprendidas) {
      if (horizontal) efeitosGlobais.push(barrasDoEstilo ?? { tipo: "barras-de-cinema", proporcao: 2.39 });
      decisoes.push({
        aspecto: "efeito/barras-de-cinema", origem: barrasAprendidas ? origemDe("efeitos-visuais", "barras-de-cinema") : "perfil",
        decisao: horizontal ? "aplicadas" : "não aplicadas: em formato vertical ou quadrado elas só reduziriam a imagem",
      });
    }

    // --- Encerramento: fade final ---------------------------------------------------------------
    const fadeFinal = plano.transicoes.encerramento === "fade-preto" ? Math.max(0.5, estilo.fadeFinalSeg) : estilo.fadeFinalSeg;

    // --- Textos na tela vindos do roteiro (cada fato do briefing, uma vez) --------------------------
    const textos = (e.roteiro?.linhas ?? []).filter((l) => l.tipo === "texto-na-tela" && !l.baseadoEm.includes("CTA"));
    for (const [n, linha] of textos.entries()) {
      const alvo = clipes.find((c, k) => plano.clipes[k]?.bloco === linha.bloco && !itens.some((x) => x.tipo === "texto" && x.ancora?.itemId === c.id)) ?? clipes[Math.min(n, clipes.length - 1)];
      if (!alvo) continue;
      itens.push({
        id: `texto-${n + 1}`, tipo: "texto", camada: 20, texto: linha.texto, inicioSeg: alvo.inicioSeg, duracaoSeg: arredondar(Math.min(3, alvo.duracaoSeg)),
        posicao: estilo.texto.posicao, tamanho: estilo.texto.tamanho, cor: "#ffffff", fundo: "", animacao: estilo.texto.animacao,
        ancora: { itemId: alvo.id, deslocamentoSeg: 0 },
      });
    }

    // --- Chamada para ação: cartão animado ou texto, conforme o estilo --------------------------------
    if (plano.cta) {
      if (estilo.encerramento === "cartao") {
        itens.push({
          id: "cartao-final", tipo: "cartao", camada: 0, inicioSeg: arredondar(Math.max(0, tempo - 0.3)), duracaoSeg: 2.5, titulo: plano.cta.texto, subtitulo: e.nomeDoProjeto,
          corDeFundo: "#0e1116", corDoTexto: "#ffffff", enquadramento: { ...CENTRO, modo: "conter" },
          entrada: { tipo: "gradual", duracaoSeg: 0.3 }, saida: fadeFinal ? { tipo: "fade", duracaoSeg: Math.min(fadeFinal, 1) } : { tipo: "corte", duracaoSeg: 0 }, efeitos: [],
        });
        tempo = arredondar(tempo - 0.3 + 2.5);
        decisoes.push({ aspecto: "cta", decisao: "cartão animado no final (HyperFrames)", origem: "perfil" });
      } else {
        const duracao = Math.min(3, tempo);
        itens.push({
          id: "texto-cta", tipo: "texto", camada: 20, texto: plano.cta.texto, inicioSeg: arredondar(tempo - duracao), duracaoSeg: arredondar(duracao),
          posicao: "centro", tamanho: estilo.texto.tamanho * 1.1, cor: "#ffffff", fundo: "rgba(0,0,0,0.6)", animacao: "subir",
        });
        decisoes.push({ aspecto: "cta", decisao: "texto sobre os últimos segundos", origem: "perfil" });
      }
    }
    const ultimo = itens.filter((x) => x.camada === 0 && x.tipo !== "cartao").at(-1);
    if (fadeFinal && ultimo && "saida" in ultimo && !itens.some((x) => x.tipo === "cartao")) ultimo.saida = { tipo: "fade", duracaoSeg: Math.min(fadeFinal, ultimo.duracaoSeg / 2) };
    if (fadeFinal) decisoes.push({ aspecto: "encerramento", decisao: `fade de ${fadeFinal} s`, origem: plano.transicoes.encerramento === "fade-preto" ? "aprendizado" : "perfil" });

    // --- Trilha sonora: só se o usuário já escolheu um arquivo ------------------------------------------
    if (plano.trilhaSonora.arquivo) {
      itens.push({
        id: "trilha", tipo: "audio", papel: "trilha", camada: 0, arquivo: plano.trilhaSonora.arquivo, inicioSeg: 0, duracaoSeg: arredondar(tempo), inicioOrigemSeg: 0,
        volume: estilo.volumeDaTrilha, fadeDeEntradaSeg: 0.3, fadeDeSaidaSeg: Math.min(1.5, tempo / 4),
        reduzirEm: itens.filter((x) => x.tipo === "legenda").map((x) => ({ inicioSeg: x.inicioSeg, fimSeg: arredondar(x.inicioSeg + x.duracaoSeg) })),
        volumeReduzido: estilo.volumeDaTrilhaNasFalas,
      });
      decisoes.push({ aspecto: "trilha", decisao: `volume ${estilo.volumeDaTrilha}, baixando para ${estilo.volumeDaTrilhaNasFalas} durante as falas`, origem: "perfil" });
    } else {
      avisos.push("Nenhuma trilha sonora foi escolhida: o vídeo sai com o som original dos trechos. Acrescente uma trilha à timeline, se quiser.");
    }

    return {
      timeline: {
        versao: 1, formato: { largura: plano.formato.largura, altura: plano.formato.altura, fps }, duracaoSeg: arredondar(tempo), itens, efeitosGlobais,
        legendas: { ...estilo.legendas },
      },
      decisoes,
      avisos,
    };
  }
}
