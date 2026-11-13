// Transforma as medições de uma referência em conhecimento reutilizável:
// regras de edição em faixas qualitativas, perfil de estilo e relatório em Markdown.
// As regras descrevem princípios ("cortes rápidos"), não a cópia do vídeo analisado.

import type { Caracteristica, RegraDeEdicao, RelatorioReferencia } from "../../src/dominio/analise.ts";

type Parcial = Pick<RelatorioReferencia, "tecnico" | "visual" | "audio" | "narrativa">;

/** As faixas são identificadores sem acento ("media", "rapido"); nos textos para leitura, voltam a ter acento. */
const acentuar = (frase: string) => frase.replace(/\bmedia\b/g, "média").replace(/\bmedio\b/g, "médio").replace(/\bmedios\b/g, "médios").replace(/\brapido\b/g, "rápido");

/** Regras deduzidas diretamente das medições. Cada uma traz um exemplo de aplicação. */
export function derivarRegras({ tecnico, visual, audio, narrativa }: Parcial): RegraDeEdicao[] {
  const regras: RegraDeEdicao[] = [];
  const regra = (r: Omit<RegraDeEdicao, "base"> & { base?: RegraDeEdicao["base"] }) =>
    regras.push({ base: "observado", ...r, descricao: acentuar(r.descricao), exemplo: acentuar(r.exemplo), confianca: Math.round(r.confianca * 100) / 100 });

  const ritmo = visual.ritmo.valor;
  if (ritmo && ritmo.planos >= 3) {
    const c = visual.ritmo.confianca;
    const cadencia = ritmo.cortesPorMinuto >= 30 ? "rapido" : ritmo.cortesPorMinuto >= 12 ? "moderado" : "lento";
    regra({
      categoria: "ritmo", chave: "cadencia-de-cortes", valor: cadencia, confianca: c,
      descricao: `Ritmo de cortes ${cadencia} (${ritmo.cortesPorMinuto} cortes por minuto na referência).`,
      exemplo: `Em um vídeo de 30 s, planejar cerca de ${Math.max(1, Math.round(ritmo.cortesPorMinuto / 2))} cortes.`,
    });
    const tipica = ritmo.duracaoMedianaSeg < 1.5 ? "curta" : ritmo.duracaoMedianaSeg <= 4 ? "media" : "longa";
    regra({
      categoria: "duracao-planos", chave: "duracao-tipica", valor: tipica, confianca: c,
      descricao: `Planos de duração ${tipica} (mediana de ${ritmo.duracaoMedianaSeg} s; de ${ritmo.duracaoMinimaSeg} s a ${ritmo.duracaoMaximaSeg} s).`,
      exemplo: `Manter cada plano perto de ${ritmo.duracaoMedianaSeg} s e evitar passar de ${ritmo.duracaoMaximaSeg} s.`,
    });
    if (ritmo.progressao !== "constante") {
      regra({
        categoria: "ritmo", chave: "progressao", valor: ritmo.progressao, confianca: c * 0.8,
        descricao: `O ritmo ${ritmo.progressao} do começo para o fim (${ritmo.porTerco.join(" → ")} cortes por minuto por terço).`,
        exemplo: ritmo.progressao === "acelera" ? "Começar com planos mais longos e encurtá-los perto do final." : "Começar com cortes rápidos e alongar os planos perto do final.",
      });
    }
  }

  const tipos = visual.tiposDeTransicao.valor;
  const totalDeTransicoes = tipos ? tipos["corte-seco"] + tipos.gradual + tipos["fade-preto"] : 0;
  if (tipos && totalDeTransicoes >= 3) {
    const graduais = (tipos.gradual + tipos["fade-preto"]) / totalDeTransicoes;
    const predominante = graduais >= 0.5 ? "gradual" : graduais >= 0.2 ? "misto" : "corte-seco";
    regra({
      categoria: "transicoes", chave: "tipo-predominante", valor: predominante, confianca: visual.tiposDeTransicao.confianca * Math.min(1, 0.5 + totalDeTransicoes / 20),
      descricao: `Transições: ${tipos["corte-seco"]} cortes secos, ${tipos.gradual} graduais e ${tipos["fade-preto"]} fades por preto.`,
      exemplo: predominante === "corte-seco" ? "Usar corte seco como padrão e reservar transições para mudanças de bloco." : "Usar dissoluções ou fades entre planos, com cortes secos como exceção.",
    });
  }

  const movimento = visual.movimentoDeCamera.valor;
  if (movimento && visual.movimentoDeCamera.confianca > 0) {
    const emMovimento = movimento.panoramica + movimento["zoom-in"] + movimento["zoom-out"];
    const intensidade = emMovimento >= 0.5 ? "frequente" : emMovimento >= 0.15 ? "ocasional" : "raro";
    regra({
      categoria: "movimentos-camera", chave: "uso", valor: intensidade, base: "estimado", confianca: visual.movimentoDeCamera.confianca,
      descricao: `Movimento de câmera ${intensidade} (${Math.round(emMovimento * 100)}% do tempo em panorâmica ou zoom).`,
      exemplo: intensidade === "raro" ? "Preferir planos estáveis; movimento só quando tiver função." : "Dar movimento aos planos com panorâmicas ou zoom suave.",
    });
    const zoom = movimento["zoom-in"] + movimento["zoom-out"];
    if (zoom >= 0.15) {
      regra({
        categoria: "zoom", chave: "uso", valor: zoom >= 0.4 ? "frequente" : "ocasional", base: "estimado", confianca: visual.movimentoDeCamera.confianca,
        descricao: `Zoom em ${Math.round(zoom * 100)}% do tempo (${movimento["zoom-in"] >= movimento["zoom-out"] ? "principalmente aproximando" : "principalmente afastando"}).`,
        exemplo: "Aplicar zoom lento em planos parados para manter a imagem viva.",
      });
    }
  }

  const cor = visual.cor.valor, luz = visual.iluminacao.valor;
  if (cor && luz) {
    regra({
      categoria: "cores", chave: "saturacao", valor: cor.classificacaoSaturacao, confianca: visual.cor.confianca,
      descricao: `Saturação ${cor.classificacaoSaturacao} e temperatura ${cor.temperatura}.`,
      exemplo: `Na correção de cor, buscar saturação ${cor.classificacaoSaturacao} e tons ${cor.temperatura === "neutra" ? "neutros" : `${cor.temperatura}s`}.`,
    });
    regra({
      categoria: "iluminacao", chave: "brilho-e-contraste", valor: `${luz.classificacaoBrilho}/${luz.classificacaoContraste}`, confianca: visual.iluminacao.confianca,
      descricao: `Imagem ${luz.classificacaoBrilho} com contraste ${luz.classificacaoContraste}.`,
      exemplo: `Ajustar exposição e contraste para uma imagem ${luz.classificacaoBrilho} de contraste ${luz.classificacaoContraste}.`,
    });
  }
  if (visual.composicao.valor?.barrasDeCinema) {
    regra({
      categoria: "efeitos-visuais", chave: "barras-de-cinema", valor: "sim", confianca: visual.composicao.confianca,
      descricao: `Barras de cinema (área útil de cerca de ${visual.composicao.valor.proporcaoUtil}).`,
      exemplo: "Aplicar barras pretas em cima e embaixo nas cenas de tom cinematográfico.",
    });
  }

  if (audio) {
    const sincronia = audio.sincroniaComCortes.valor;
    if (sincronia && sincronia.cortesAvaliados >= 3 && sincronia.fracao >= 0.5 && sincronia.fracao > sincronia.fracaoEsperadaAoAcaso + 0.15) {
      regra({
        categoria: "sincronizacao-musical", chave: "cortes-na-batida", valor: "sim", confianca: audio.sincroniaComCortes.confianca,
        descricao: `Cortes sincronizados com o áudio: ${sincronia.cortesNaBatida} de ${sincronia.cortesAvaliados} caem sobre um ataque sonoro (ao acaso seriam ${Math.round(sincronia.fracaoEsperadaAoAcaso * 100)}%).`,
        exemplo: "Posicionar os cortes sobre as batidas da trilha escolhida.",
      });
    }
    const bpm = audio.batidas.valor?.bpm;
    if (bpm) {
      const andamento = bpm >= 130 ? "rapido" : bpm >= 90 ? "medio" : "lento";
      regra({
        categoria: "trilha-sonora", chave: "andamento", valor: andamento, base: "estimado", confianca: audio.batidas.confianca,
        descricao: `Trilha com pulso marcado, andamento ${andamento} (cerca de ${bpm} batidas por minuto).`,
        exemplo: `Escolher trilha com andamento ${andamento}, perto de ${bpm} batidas por minuto.`,
      });
    }
    const fala = audio.fala.valor;
    if (audio.fala.base === "estimado" && fala) {
      const proporcao = fala.tempoDeFalaSeg / Math.max(1, tecnico.duracaoSeg);
      const presenca = proporcao >= 0.5 ? "predominante" : proporcao >= 0.15 ? "pontual" : "ausente";
      regra({
        categoria: "narrativa", chave: "presenca-de-fala", valor: presenca, base: "estimado", confianca: audio.fala.confianca,
        descricao: `Fala ${presenca} (${Math.round(proporcao * 100)}% da duração).`,
        exemplo: presenca === "ausente" ? "Conduzir o vídeo por imagem e música, sem locução." : "Estruturar o vídeo em torno da fala e cobrir com imagens.",
      });
    }
  }

  if (narrativa.encerramento.valor && visual.transicoes.some((t) => t.tipo === "fade-preto" && t.tempoSeg >= tecnico.duracaoSeg * 0.85)) {
    regra({
      categoria: "transicoes", chave: "encerramento", valor: "fade-preto", confianca: 0.7,
      descricao: "Encerramento com fade para preto.", exemplo: "Terminar o vídeo com fade para preto em vez de corte.",
    });
  }
  return regras;
}

/** Resumo do estilo: uma faixa por aspecto, a partir das regras. */
export function perfilDeEstilo(regras: RegraDeEdicao[]): Record<string, string> {
  return Object.fromEntries(regras.map((r) => [`${r.categoria}/${r.chave}`, r.valor]));
}

const ROTULO = { observado: "observado", estimado: "estimado", "nao-avaliado": "não avaliado", "nao-aplicavel": "não se aplica" } as const;
const porcento = (n: number) => `${Math.round(n * 100)}%`;

function linha(nome: string, c: Caracteristica, valor: string): string {
  const conteudo = c.valor === null ? `_${c.metodo}_` : valor;
  return `| ${nome} | ${conteudo} | ${ROTULO[c.base]}${c.confianca ? ` (${porcento(c.confianca)})` : ""} |`;
}

/** Relatório legível da análise, com a mesma informação essencial do JSON. */
export function paraMarkdown(r: RelatorioReferencia): string {
  const { tecnico: t, visual: v, audio: a, narrativa: n } = r;
  const ritmo = v.ritmo.valor, tipos = v.tiposDeTransicao.valor, mov = v.movimentoDeCamera.valor, cor = v.cor.valor, luz = v.iluminacao.valor;
  const cabecalho = "| Item | Resultado | Base |\n|---|---|---|";
  const elemento = (nome: string, c: Caracteristica<{ descricao: string; inicioSeg?: number }>) =>
    linha(nome, c, c.valor ? `${c.valor.descricao}${c.valor.inicioSeg !== undefined ? ` (${c.valor.inicioSeg} s)` : ""}` : "");

  const partes = [
    `# Análise de referência: ${r.referencia.titulo}`,
    `Perfil: **${r.perfil}** · Analisado em ${r.analisadoEm.slice(0, 10)} · Confiança geral: **${porcento(r.confiancaGeral)}**`,
    "> **Observado** é o que foi medido no arquivo. **Estimado** é interpretação, por heurística ou por modelo de IA.\n> As regras descrevem princípios aplicáveis a outros vídeos, não a cópia desta referência.",
    "## Dados técnicos",
    `${t.largura}×${t.altura} (${t.proporcao}, ${t.orientacao}), ${t.fps} quadros/s, ${t.duracaoSeg.toFixed(1)} s, vídeo ${t.codecVideo}, áudio ${t.codecAudio ?? "ausente"}.`,
    `Amostragem: ${v.amostragem.quadrosAnalisados} de ${v.amostragem.quadrosDoVideo} quadros (${v.amostragem.quadrosPorSegundo} por segundo, ${v.amostragem.resolucao}).`,
    "## Imagem",
    cabecalho,
    linha("Ritmo", v.ritmo, ritmo ? `${ritmo.planos} planos, ${ritmo.cortesPorMinuto} cortes/min, progressão ${ritmo.progressao}` : ""),
    linha("Duração dos planos", v.ritmo, ritmo ? `mediana ${ritmo.duracaoMedianaSeg} s (de ${ritmo.duracaoMinimaSeg} s a ${ritmo.duracaoMaximaSeg} s)` : ""),
    linha("Transições", v.tiposDeTransicao, tipos ? `${tipos["corte-seco"]} cortes secos, ${tipos.gradual} graduais, ${tipos["fade-preto"]} fades por preto` : ""),
    linha("Movimento de câmera", v.movimentoDeCamera, mov ? `estático ${porcento(mov.estatico)}, panorâmica ${porcento(mov.panoramica)}, zoom ${porcento(mov["zoom-in"] + mov["zoom-out"])}, complexo ${porcento(mov.complexo)}` : ""),
    linha("Cor", v.cor, cor ? `saturação ${cor.classificacaoSaturacao}, temperatura ${cor.temperatura}, dominantes ${cor.coresDominantes.map((c) => c.hex).join(" ")}` : ""),
    linha("Iluminação", v.iluminacao, luz ? `imagem ${luz.classificacaoBrilho}, contraste ${luz.classificacaoContraste}` : ""),
    linha("Composição", v.composicao, v.composicao.valor ? `${v.composicao.valor.barrasDeCinema ? "com" : "sem"} barras de cinema, área útil ${v.composicao.valor.proporcaoUtil}` : ""),
    linha("Enquadramentos", v.enquadramentos, v.enquadramentos.valor ?? ""),
    linha("Efeitos", v.efeitos, v.efeitos.valor ?? ""),
    linha("Tipografia", v.tipografia, v.tipografia.valor ?? ""),
    linha("Legendas", v.legendas, v.legendas.valor ?? ""),
    linha("Animações", v.animacoes, v.animacoes.valor ?? ""),
    "## Áudio",
  ];
  if (!a) partes.push("O arquivo não tem faixa de áudio.");
  else {
    const vol = a.volume.valor, bat = a.batidas.valor, sinc = a.sincroniaComCortes.valor;
    partes.push(
      cabecalho,
      linha("Volume", a.volume, vol ? `pico ${vol.picoDb} dBFS, médio ${vol.medioDb} dBFS, faixa dinâmica ${vol.faixaDinamicaDb} dB` : ""),
      linha("Silêncios", a.silencios, `${a.silencios.valor?.length ?? 0} trecho(s)`),
      linha("Mudanças de intensidade", a.mudancasDeIntensidade, (a.mudancasDeIntensidade.valor ?? []).map((m) => `${m.tipo} em ${m.tempoSeg} s`).join(", ") || "nenhuma"),
      linha("Batidas", a.batidas, bat ? `${bat.ataques} ataques${bat.bpm ? `, cerca de ${bat.bpm} batidas/min` : ", sem pulso regular"}` : ""),
      linha("Pontos de corte musical", a.pontosDeCorteMusical, `${a.pontosDeCorteMusical.valor?.length ?? 0} instante(s) candidatos`),
      linha("Sincronia com os cortes", a.sincroniaComCortes, sinc ? `${sinc.cortesNaBatida} de ${sinc.cortesAvaliados} cortes sobre um ataque (acaso: ${porcento(sinc.fracaoEsperadaAoAcaso)})` : ""),
      linha("Trilha sonora", a.trilhaSonora, a.trilhaSonora.valor ?? ""),
      linha("Efeitos sonoros", a.efeitosSonoros, a.efeitosSonoros.valor ?? ""),
      linha("Fala", a.fala, a.fala.valor?.segmentos.length ? `${a.fala.valor.tempoDeFalaSeg} s de fala (${a.fala.valor.idioma}): "${a.fala.valor.texto.slice(0, 200)}"` : "nenhuma fala detectada"),
      linha("Diálogos e narração", a.dialogosENarracao, a.dialogosENarracao.valor ?? ""),
    );
  }
  partes.push(
    "## Narrativa",
    `Estrutura considerada: **${n.estrutura === "curta" ? "vídeo curto de divulgação" : "formato livre"}**.`,
    cabecalho,
    elemento("Gancho inicial", n.hook), elemento("Desenvolvimento", n.desenvolvimento), elemento("Progressão", n.progressao),
    linha("Destaques", n.destaques, (n.destaques.valor ?? []).map((d) => `${d.inicioSeg} s`).join(", ")),
    elemento("Suspense", n.suspense), elemento("Humor", n.humor), elemento("Emoção", n.emocao),
    elemento("Clímax", n.climax), elemento("Encerramento", n.encerramento), elemento("Chamada para ação", n.cta),
    "## Tipos de conteúdo",
    r.tiposDeConteudo.valor === null
      ? `_${r.tiposDeConteudo.metodo}_`
      : r.tiposDeConteudo.valor.map((tipo) => `- ${tipo.nome}: ${porcento(tipo.pontuacao)} dos sinais (estimado)`).join("\n") || "Nenhum tipo do perfil reconhecido com clareza.",
    "## Regras de edição identificadas",
    "| Categoria | Regra | Como aplicar | Base | Confiança |\n|---|---|---|---|---|",
    ...r.regras.map((regra) => `| ${regra.categoria} | ${regra.descricao} | ${regra.exemplo} | ${ROTULO[regra.base]} | ${porcento(regra.confianca)} |`),
    "## Limitações",
    r.limitacoes.map((l) => `- ${l}`).join("\n") || "Nenhuma.",
  );
  if (r.modelosUsados.length) partes.push("## Modelos de IA usados", r.modelosUsados.map((m) => `- ${m}`).join("\n"));
  const [titulo, ...resto] = partes;
  return `${titulo}\n\n${acentuar(resto.join("\n\n").replace(/\|\n\n\|/g, "|\n|"))}\n`;
}
