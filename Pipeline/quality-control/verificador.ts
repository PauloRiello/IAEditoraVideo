// Agente de Qualidade: confere a timeline antes do render e o arquivo depois dele.
// O arquivo é examinado com FFmpeg e FFprobe, sem passar pelo renderizador: o que o
// Remotion produziu é medido por ferramentas independentes dele.

import { closeSync, existsSync, openSync, readSync } from "node:fs";
import type { Agente } from "../../src/dominio/producao.ts";
import type { Gravidade, PerfilDeQualidade, Verificacao } from "../../src/dominio/qualidade.ts";
import { AREA_SEGURA_PADRAO, type ItemDaTimeline, type ItemVideo, type Timeline } from "../../src/dominio/timeline.ts";
import { medirAudio } from "../analysis/audio.ts";
import { errosDeDecodificacao, executar, executarDetalhado, ffmpeg, sondar } from "../analysis/ferramentas.ts";
import { medirVisual } from "../analysis/visual.ts";

type Visual = Extract<ItemDaTimeline, { tipo: "video" | "imagem" | "cartao" }>;

export interface ContextoDaTimeline {
  perfil: PerfilDeQualidade;
  /** O plano previa uma chamada para ação. */
  ctaPrevisto: boolean;
}

export interface ContextoDoArquivo extends ContextoDaTimeline {
  /** Resolução e taxa de quadros que o arquivo deveria ter. */
  esperado: { largura: number; altura: number; fps: number };
  /** Quantas tentativas o render precisou. */
  tentativas: number;
}

const arredondar = (n: number, casas = 2) => Math.round(n * 10 ** casas) / 10 ** casas;
const principal = (t: Timeline): Visual[] =>
  t.itens.filter((i): i is Visual => i.camada === 0 && (i.tipo === "video" || i.tipo === "imagem" || i.tipo === "cartao")).sort((a, b) => a.inicioSeg - b.inicioSeg);

/** Luminância relativa de uma cor (0 = preto, 1 = branco), para estimar contraste. */
function luminancia(r: number, g: number, b: number): number {
  const canal = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}
function luminanciaDaCor(cor: string): number | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(cor.trim())?.[1];
  if (!hex) return null;
  const cheio = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  return luminancia(parseInt(cheio.slice(0, 2), 16), parseInt(cheio.slice(2, 4), 16), parseInt(cheio.slice(4, 6), 16));
}

/** O átomo "moov" vem antes do "mdat": o vídeo começa a tocar antes de baixar inteiro. */
function inicioRapido(arquivo: string): boolean | null {
  const descritor = openSync(arquivo, "r");
  try {
    const cabecalho = Buffer.alloc(16);
    let posicao = 0;
    for (let n = 0; n < 64; n += 1) {
      if (readSync(descritor, cabecalho, 0, 16, posicao) < 8) return null;
      const tipo = cabecalho.toString("latin1", 4, 8);
      if (tipo === "moov") return true;
      if (tipo === "mdat") return false;
      const tamanho = cabecalho.readUInt32BE(0);
      const real = tamanho === 1 ? Number(cabecalho.readBigUInt64BE(8)) : tamanho;
      if (real < 8) return null;
      posicao += real;
    }
    return null;
  } finally {
    closeSync(descritor);
  }
}

export class AgenteDeQualidade implements Agente {
  id = "qualidade";
  nome = "Agente de Qualidade";
  responsabilidade = "Conferir a timeline e o arquivo exportado e apontar problemas, com gravidade e sugestão de correção.";

  /**
   * Verificações que não dependem do render: arquivos, textos, legendas, áreas seguras,
   * enquadramento, efeitos, trilha e critérios do destino.
   */
  async verificarTimeline(t: Timeline, c: ContextoDaTimeline): Promise<Verificacao[]> {
    const lista: Verificacao[] = [];
    const p = c.perfil;
    const registrar = (
      id: string, grupo: Verificacao["grupo"], nome: string, gravidade: Gravidade, problemas: string[], aprovada: string, sugestao: string, extra: Partial<Verificacao> = {},
    ) => lista.push({ id, grupo, nome, gravidade, situacao: problemas.length ? "reprovada" : "aprovada", detalhe: problemas.length ? problemas.join(" ") : aprovada, sugestao: problemas.length ? sugestao : "", base: "observado", ...extra });
    const naoAplicavel = (id: string, grupo: Verificacao["grupo"], nome: string, motivo: string) =>
      lista.push({ id, grupo, nome, gravidade: "recomendacao", situacao: "nao-aplicavel", detalhe: motivo, sugestao: "", base: "observado" });

    const faixa = principal(t);
    const clipes = faixa.filter((i): i is ItemVideo => i.tipo === "video");
    const textos = t.itens.filter((i): i is Extract<ItemDaTimeline, { tipo: "texto" }> => i.tipo === "texto");
    const legendas = t.itens.filter((i): i is Extract<ItemDaTimeline, { tipo: "legenda" }> => i.tipo === "legenda");
    const trilha = t.itens.find((i): i is Extract<ItemDaTimeline, { tipo: "audio" }> => i.tipo === "audio" && i.papel === "trilha");
    const { largura, altura } = t.formato;
    const orientacao = largura === altura ? "quadrado" : largura > altura ? "horizontal" : "vertical";

    // --- Técnica ----------------------------------------------------------------------
    const ausentes = t.itens.filter((i) => "arquivo" in i && !existsSync(i.arquivo)).map((i) => `${i.id} (${"arquivo" in i ? i.arquivo : ""})`);
    registrar("tecnica/arquivos-ausentes", "tecnica", "Arquivos de origem", "obrigatoria", ausentes.length ? [`Arquivo não encontrado: ${ausentes.join(", ")}.`] : [],
      "Todos os arquivos usados na timeline existem.", "Recoloque o arquivo no lugar ou remova o item da timeline.");
    registrar("tecnica/conteudo", "tecnica", "Conteúdo da timeline", "obrigatoria", faixa.length === 0 || t.duracaoSeg < 0.5 ? ["A timeline não tem nenhum clipe na faixa principal."] : [],
      `${faixa.length} item(ns) na faixa principal, ${t.duracaoSeg} s.`, "Monte a timeline a partir do plano aprovado.");

    // --- Destino: proporção e duração ---------------------------------------------------
    if (p.proporcao.orientacao === "qualquer") naoAplicavel("destino/proporcao", "destino", "Proporção", `O destino ${p.nome} aceita qualquer proporção.`);
    else registrar("destino/proporcao", "destino", "Proporção", p.proporcao.gravidade, orientacao === p.proporcao.orientacao ? [] : [`O vídeo é ${orientacao} (${largura}×${altura}) e o destino ${p.nome} pede formato ${p.proporcao.orientacao}.`],
      `Formato ${orientacao}, como o destino pede.`, "Mude o formato da timeline ou exporte com outro destino.");
    if (p.duracao.maximaSeg === null) naoAplicavel("destino/duracao", "destino", "Duração para o destino", `O destino ${p.nome} não limita a duração.`);
    else registrar("destino/duracao", "destino", "Duração para o destino", p.duracao.gravidade, t.duracaoSeg <= p.duracao.maximaSeg ? [] : [`O vídeo tem ${t.duracaoSeg} s; o destino ${p.nome} pede até ${p.duracao.maximaSeg} s.`],
      `${t.duracaoSeg} s, dentro do limite de ${p.duracao.maximaSeg} s.`, "Encurte ou remova clipes.");

    // --- Visual: textos ---------------------------------------------------------------------
    if (textos.length === 0) naoAplicavel("visual/legibilidade-dos-textos", "visual", "Legibilidade dos textos", "A timeline não tem textos.");
    else {
      const problemas: string[] = [];
      for (const x of textos) {
        if (x.tamanho < p.texto.tamanhoMinimo) problemas.push(`"${x.texto.slice(0, 30)}": letra com ${arredondar(x.tamanho * 100, 1)}% da altura; o mínimo para ${p.nome} é ${arredondar(p.texto.tamanhoMinimo * 100, 1)}%.`);
        const leitura = arredondar(0.6 + x.texto.length / 18, 1);
        if (x.duracaoSeg < leitura) problemas.push(`"${x.texto.slice(0, 30)}": fica ${x.duracaoSeg} s na tela; para ler são necessários cerca de ${leitura} s.`);
      }
      registrar("visual/legibilidade-dos-textos", "visual", "Legibilidade dos textos", p.texto.gravidade, problemas, `${textos.length} texto(s) com tamanho e tempo de leitura adequados.`, "Aumente a letra ou o tempo do texto na tela.");

      // Texto largo demais para o quadro: estimativa pela quantidade de letras.
      const fora: string[] = [];
      const margens = t.areaSegura ?? AREA_SEGURA_PADRAO;
      for (const x of textos) {
        const porLinha = Math.max(1, Math.floor((largura * (1 - 2 * margens.lados)) / (altura * x.tamanho * 0.56)));
        const linhas = Math.ceil(x.texto.length / porLinha);
        const maiorPalavra = Math.max(...x.texto.split(/\s+/).map((palavra) => palavra.length));
        if (maiorPalavra > porLinha) fora.push(`"${x.texto.slice(0, 30)}": há palavra mais larga que o quadro.`);
        else if (linhas * x.tamanho * 1.15 > 0.5) fora.push(`"${x.texto.slice(0, 30)}": ocuparia cerca de ${linhas} linhas, mais da metade da altura.`);
      }
      registrar("visual/elementos-fora-da-tela", "visual", "Textos dentro do quadro", "importante", fora, "Os textos cabem no quadro.", "Reduza o texto ou a letra.", { base: "estimado" });
    }

    // --- Visual: legendas --------------------------------------------------------------------
    if (legendas.length === 0) naoAplicavel("visual/legendas", "visual", "Legendas", "A timeline não tem legendas.");
    else {
      const problemas: string[] = [];
      if (t.legendas.tamanho < p.legendas.tamanhoMinimo) problemas.push(`Letra das legendas com ${arredondar(t.legendas.tamanho * 100, 1)}% da altura; o mínimo para ${p.nome} é ${arredondar(p.legendas.tamanhoMinimo * 100, 1)}%.`);
      const longas = legendas.filter((l) => l.texto.length > p.legendas.maximoDeCaracteres);
      if (longas.length) problemas.push(`${longas.length} legenda(s) com mais de ${p.legendas.maximoDeCaracteres} letras: difíceis de ler de uma vez.`);
      const rapidas = legendas.filter((l) => l.texto.length / Math.max(0.1, l.duracaoSeg) > 25);
      if (rapidas.length) problemas.push(`${rapidas.length} legenda(s) passam rápido demais (mais de 25 letras por segundo).`);
      registrar("visual/legendas", "visual", "Legendas", "importante", problemas, `${legendas.length} legenda(s) com tamanho e ritmo de leitura adequados.`, "Aumente a letra ou divida as legendas longas em partes menores.");
    }

    // --- Visual: áreas seguras ------------------------------------------------------------------
    if (textos.length + legendas.length === 0) naoAplicavel("visual/areas-seguras", "visual", "Áreas seguras", "Não há textos nem legendas a posicionar.");
    else {
      const m = t.areaSegura ?? AREA_SEGURA_PADRAO;
      const problemas = (["topo", "base", "lados"] as const)
        .filter((lado) => m[lado] + 1e-9 < p.areaSegura[lado])
        .map((lado) => `Margem ${lado === "lados" ? "lateral" : `do ${lado === "topo" ? "topo" : "rodapé"}`} de ${arredondar(m[lado] * 100, 0)}%; o destino ${p.nome} pede ${arredondar(p.areaSegura[lado] * 100, 0)}% para não ficar sob a interface.`);
      registrar("visual/areas-seguras", "visual", "Áreas seguras", p.areaSegura.gravidade, problemas, "Textos e legendas ficam dentro da área segura do destino.",
        `Use a operação "apresentacao" com areaSegura { topo: ${p.areaSegura.topo}, base: ${p.areaSegura.base}, lados: ${p.areaSegura.lados} }.`);
    }

    // --- Visual: enquadramento --------------------------------------------------------------------
    const enquadramento: string[] = [];
    for (const clipe of clipes) {
      const e = clipe.enquadramento;
      if (e.x < 0 || e.x > 1 || e.y < 0 || e.y > 1 || e.zoom < 0.2) enquadramento.push(`${clipe.id}: posição ou zoom fora do quadro.`);
      if (!existsSync(clipe.arquivo)) continue;
      const origem = await sondar(clipe.arquivo);
      const escalas = [largura / origem.largura, altura / origem.altura];
      const escala = (e.modo === "preencher" ? Math.max(...escalas) : Math.min(...escalas)) * e.zoom;
      if (escala > 1.5) enquadramento.push(`${clipe.id}: a imagem será ampliada ${arredondar(escala, 1)}× (original de ${origem.largura}×${origem.altura}) e perderá nitidez.`);
      if (e.modo === "preencher") {
        const visivel = Math.min(1, (largura / (origem.largura * escala)) * (altura / (origem.altura * escala)));
        if (visivel < 0.4) enquadramento.push(`${clipe.id}: o recorte mostra só ${Math.round(visivel * 100)}% da imagem original.`);
      }
    }
    registrar("visual/enquadramento", "visual", "Enquadramento", "recomendacao", enquadramento, "Os clipes preenchem o quadro sem ampliação nem recorte excessivos.",
      "Ajuste a posição do recorte (x, y), use o modo \"conter\" ou troque por material no formato do vídeo.");

    // --- Visual: transições e efeitos ----------------------------------------------------------------
    const transicoes = faixa.filter((item, i) => item.entrada.tipo === "gradual" && (i === 0 || item.entrada.duracaoSeg > Math.min(item.duracaoSeg, faixa[i - 1].duracaoSeg) / 2))
      .map((item) => `${item.id}: transição de ${item.entrada.duracaoSeg} s longa demais para a duração dos clipes.`);
    registrar("visual/transicoes", "visual", "Transições", "recomendacao", transicoes, "As transições cabem na duração dos clipes.", "Reduza a duração da transição.");
    const efeitos: string[] = [];
    if (t.efeitosGlobais.some((e) => e.tipo === "barras-de-cinema") && orientacao !== "horizontal") efeitos.push("Barras de cinema em formato vertical ou quadrado só reduzem a área da imagem.");
    for (const clipe of clipes) {
      for (const e of clipe.efeitos) {
        if (e.tipo === "cor" && (e.saturacao > 1.5 || e.saturacao < 0.5 || e.contraste > 1.4 || e.contraste < 0.7 || e.brilho > 1.3 || e.brilho < 0.7)) efeitos.push(`${clipe.id}: correção de cor extrema.`);
        if (e.tipo === "zoom-lento" && e.intensidade > 0.25) efeitos.push(`${clipe.id}: zoom lento muito forte (${e.intensidade}).`);
      }
    }
    registrar("visual/efeitos", "visual", "Efeitos", "recomendacao", efeitos, "Efeitos dentro de limites razoáveis.", "Reduza a intensidade ou remova o efeito.");

    // --- Áudio: trilha ------------------------------------------------------------------------------------
    if (!trilha) naoAplicavel("audio/trilha", "audio", "Trilha sonora", "A timeline não tem trilha sonora.");
    else {
      const problemas: string[] = [];
      if (trilha.inicioSeg + trilha.duracaoSeg < t.duracaoSeg * 0.95) problemas.push(`A trilha cobre ${arredondar(trilha.duracaoSeg)} s de um vídeo de ${t.duracaoSeg} s.`);
      if (existsSync(trilha.arquivo)) {
        const info = JSON.parse((await executar(process.env.IAEV_FFPROBE ?? "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", trilha.arquivo])).toString()) as { format?: { duration?: string } };
        const disponivel = Number(info.format?.duration ?? 0) - trilha.inicioOrigemSeg;
        if (disponivel + 0.1 < trilha.duracaoSeg) problemas.push(`O arquivo da trilha termina ${arredondar(trilha.duracaoSeg - disponivel)} s antes do fim do trecho usado.`);
      }
      registrar("audio/trilha", "audio", "Trilha sonora", "importante", problemas, "A trilha cobre o vídeo inteiro.", "Use uma trilha mais longa ou encurte o vídeo.");
    }

    // --- Destino: ritmo e chamada para ação -------------------------------------------------------------------
    if (p.ritmo.duracaoMaximaDoPlanoSeg === null) naoAplicavel("destino/ritmo", "destino", "Ritmo para o destino", `O destino ${p.nome} não impõe ritmo de cortes.`);
    else {
      const longos = clipes.filter((clipe) => clipe.duracaoSeg > (p.ritmo.duracaoMaximaDoPlanoSeg as number)).map((clipe) => `${clipe.id} (${clipe.duracaoSeg} s)`);
      registrar("destino/ritmo", "destino", "Ritmo para o destino", "recomendacao", longos.length ? [`Planos mais longos que ${p.ritmo.duracaoMaximaDoPlanoSeg} s: ${longos.join(", ")}.`] : [],
        `Nenhum plano passa de ${p.ritmo.duracaoMaximaDoPlanoSeg} s.`, "Divida ou encurte os planos longos, se o conteúdo permitir.");
    }
    const temCta = t.itens.some((i) => i.tipo === "cartao" || i.id === "texto-cta");
    if (c.ctaPrevisto) registrar("destino/cta", "destino", "Chamada para ação", "importante", temCta ? [] : ["O plano previa uma chamada para ação, mas ela não está na timeline."], "A chamada para ação do plano está na timeline.", "Insira o texto ou o cartão da chamada para ação.");
    else if (p.cta === "recomendado") registrar("destino/cta", "destino", "Chamada para ação", "recomendacao", temCta ? [] : [`Vídeos para ${p.nome} costumam terminar com uma chamada para ação; este não tem.`], "O vídeo tem chamada para ação.", "Informe o texto do CTA no briefing, se fizer sentido para este vídeo.");
    else naoAplicavel("destino/cta", "destino", "Chamada para ação", `O destino ${p.nome} não pede chamada para ação.`);

    return lista;
  }

  /** Verificações feitas sobre o arquivo renderizado, medido com FFmpeg e FFprobe. */
  async verificarArquivo(arquivo: string, t: Timeline, c: ContextoDoArquivo): Promise<Verificacao[]> {
    const lista: Verificacao[] = [];
    const p = c.perfil;
    const registrar = (
      id: string, grupo: Verificacao["grupo"], nome: string, gravidade: Gravidade, problema: string | null, aprovada: string, sugestao: string, extra: Partial<Verificacao> = {},
    ) => lista.push({ id, grupo, nome, gravidade, situacao: problema ? "reprovada" : "aprovada", detalhe: problema ?? aprovada, sugestao: problema ? sugestao : "", base: "observado", ...extra });
    const refazer = "Exporte de novo; se o problema se repetir, revise os arquivos de origem.";

    // --- Integridade: se o arquivo não abre, nada mais pode ser medido ---------------------------
    const sonda = existsSync(arquivo) ? await executarDetalhado(process.env.IAEV_FFPROBE ?? "ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", arquivo]) : null;
    const dados = sonda?.codigo === 0 ? (JSON.parse(sonda.saida.toString()) as {
      format: { format_name?: string; duration?: string };
      streams: { codec_type: string; codec_name: string; profile?: string; pix_fmt?: string; width?: number; height?: number; r_frame_rate?: string; duration?: string; start_time?: string; sample_rate?: string }[];
    }) : null;
    const video = dados?.streams.find((s) => s.codec_type === "video");
    if (!dados || !video) {
      registrar("tecnica/integridade", "tecnica", "Integridade do arquivo", "obrigatoria", "O arquivo não existe ou não pôde ser lido como vídeo.", "", refazer);
      return lista;
    }
    const erros = await errosDeDecodificacao(arquivo);
    registrar("tecnica/integridade", "tecnica", "Integridade do arquivo", "obrigatoria", erros ? `Erros ao decodificar: ${erros.split("\n")[0].replace(/ @ 0x[0-9a-f]+/i, "").slice(0, 160)}` : null,
      "O arquivo foi decodificado do início ao fim sem erros.", refazer);
    registrar("tecnica/erros-de-render", "tecnica", "Renderização", "recomendacao", c.tentativas > 1 ? `O render só terminou na ${c.tentativas}ª tentativa, em modo conservador.` : null,
      "Renderizado na primeira tentativa.", "Verifique memória livre e, se houver, o driver da placa de vídeo.");

    // --- Formato, codecs e compatibilidade ---------------------------------------------------------------
    const audio = dados.streams.find((s) => s.codec_type === "audio");
    const [n, d] = (video.r_frame_rate ?? "0/1").split("/").map(Number);
    const fps = d ? arredondar(n / d) : 0;
    const duracao = Number(dados.format.duration ?? 0);
    registrar("tecnica/codec-de-video", "tecnica", "Codec de vídeo", "obrigatoria", video.codec_name === "h264" ? null : `Vídeo em ${video.codec_name}; o padrão de exportação é H.264.`, "Vídeo em H.264.", refazer);
    registrar("tecnica/codec-de-audio", "tecnica", "Codec de áudio", "obrigatoria", !audio || audio.codec_name === "aac" ? null : `Áudio em ${audio.codec_name}; o padrão de exportação é AAC.`, audio ? "Áudio em AAC." : "Sem faixa de áudio.", refazer);
    registrar("tecnica/resolucao", "tecnica", "Resolução", "obrigatoria", video.width === c.esperado.largura && video.height === c.esperado.altura ? null : `Resolução de ${video.width}×${video.height}; a esperada era ${c.esperado.largura}×${c.esperado.altura}.`,
      `${video.width}×${video.height}, como configurado.`, refazer);
    registrar("tecnica/fps", "tecnica", "Taxa de quadros", "obrigatoria", Math.abs(fps - c.esperado.fps) <= 0.01 ? null : `${fps} quadros/s; os esperados eram ${c.esperado.fps}.`, `${fps} quadros/s, como configurado.`, refazer);
    registrar("tecnica/duracao", "tecnica", "Duração", "obrigatoria", Math.abs(duracao - t.duracaoSeg) <= 0.25 ? null : `Duração de ${arredondar(duracao)} s; a timeline tem ${t.duracaoSeg} s.`, `${arredondar(duracao)} s, igual à timeline.`, refazer);
    const compat = [
      (dados.format.format_name ?? "").includes("mp4") ? "" : `contêiner ${dados.format.format_name}, não MP4`,
      video.pix_fmt === "yuv420p" ? "" : `formato de cor ${video.pix_fmt} (muitos aparelhos só tocam yuv420p)`,
      (video.width ?? 0) % 2 || (video.height ?? 0) % 2 ? "largura ou altura ímpar" : "",
    ].filter(Boolean);
    registrar("tecnica/compatibilidade", "tecnica", "Compatibilidade", "obrigatoria", compat.length ? `Pode não tocar em todos os aparelhos: ${compat.join("; ")}.` : null,
      `MP4, ${video.codec_name} ${video.profile ?? ""}, ${video.pix_fmt}: toca em celulares, navegadores e redes sociais.`, refazer);
    const amostragem = Number(audio?.sample_rate ?? 0);
    const rapido = inicioRapido(arquivo);
    const avisos = [audio && ![44100, 48000].includes(amostragem) ? `áudio a ${amostragem} Hz (o usual é 44100 ou 48000)` : "", rapido === false ? "o índice do arquivo está no final: o vídeo só começa a tocar depois de baixar inteiro" : ""].filter(Boolean);
    registrar("tecnica/compatibilidade-na-web", "tecnica", "Reprodução pela internet", "recomendacao", avisos.length ? `${avisos.join("; ")}.` : null, "Pronto para reprodução progressiva na internet.", refazer);

    // --- Medição de imagem e som, com as mesmas rotinas da análise de vídeos -----------------------------------
    const tecnico = await sondar(arquivo);
    const visual = await medirVisual(arquivo, tecnico);
    const som = tecnico.temAudio ? await medirAudio(arquivo, visual.cortesSeg) : null;
    const faixa = principal(t);

    // Quadros pretos: são esperados no fade final e em cartões de fundo escuro; no meio do vídeo, não.
    const ultimo = faixa.at(-1);
    const permitidos = [
      ...faixa.filter((i) => i.tipo === "cartao" && (luminanciaDaCor(i.corDeFundo) ?? 1) < 0.02).map((i) => ({ inicioSeg: i.inicioSeg - 0.3, fimSeg: i.inicioSeg + i.duracaoSeg + 0.3 })),
      ...(ultimo && ultimo.saida.tipo === "fade" ? [{ inicioSeg: t.duracaoSeg - ultimo.saida.duracaoSeg - 0.3, fimSeg: t.duracaoSeg + 1 }] : []),
    ];
    const pretos = visual.sinais.pretos.filter((x) => !permitidos.some((ok) => x.inicioSeg >= ok.inicioSeg && x.fimSeg <= ok.fimSeg));
    const tempoPreto = pretos.reduce((s, x) => s + x.fimSeg - x.inicioSeg, 0);
    registrar("tecnica/quadros-pretos", "tecnica", "Quadros pretos inesperados", tempoPreto > duracao * 0.5 ? "obrigatoria" : "importante",
      pretos.length ? `Tela preta em ${pretos.map((x) => `${x.inicioSeg}–${x.fimSeg} s`).join(", ")}.` : null, "Nenhum trecho de tela preta fora dos fades e cartões.",
      "Confira o material de origem nesses instantes ou remova o trecho.", pretos[0] ? { inicioSeg: pretos[0].inicioSeg, fimSeg: pretos[0].fimSeg } : {});

    // Cortes que não correspondem a uma troca de clipe na timeline.
    const trocas = faixa.slice(1).map((i) => i.inicioSeg);
    const inesperados = visual.transicoes.filter((x) => x.tipo === "corte-seco" && !trocas.some((troca) => Math.abs(troca - x.tempoSeg) <= 0.3)).map((x) => x.tempoSeg);
    registrar("visual/cortes-inesperados", "visual", "Cortes inesperados", "recomendacao",
      inesperados.length ? `Mudança brusca de imagem em ${inesperados.slice(0, 6).map((s) => `${s} s`).join(", ")}, fora das trocas de clipe da timeline. Pode ser um corte que já existia no material.` : null,
      "Todas as mudanças bruscas de imagem coincidem com trocas de clipe da timeline.", "Assista a esses instantes; se o corte não for desejado, ajuste o início ou o fim do clipe.",
      { base: "estimado", ...(inesperados[0] !== undefined ? { inicioSeg: inesperados[0] } : {}) });

    // Continuidade e contraste dos textos: uma amostra de quadro por clipe e por texto.
    const amostrar = async (segundo: number) => {
      const bruto = await ffmpeg(["-ss", String(Math.max(0, Math.min(segundo, duracao - 0.05))), "-i", arquivo, "-frames:v", "1", "-vf", "scale=32:32,format=rgb24", "-f", "rawvideo", "-"]);
      const faixas = [0, 0, 0];
      for (let px = 0; px < 1024; px += 1) faixas[Math.min(2, Math.floor(px / 32 / 10.67))] += luminancia(bruto[px * 3], bruto[px * 3 + 1], bruto[px * 3 + 2]) / (1024 / 3);
      return { topo: faixas[0], centro: faixas[1], base: faixas[2], media: (faixas[0] + faixas[1] + faixas[2]) / 3 };
    };
    const clipes = faixa.filter((i) => i.tipo === "video");
    const luz = await Promise.all(clipes.map((i) => amostrar(i.inicioSeg + i.duracaoSeg / 2)));
    const saltos = clipes.slice(1).flatMap((clipe, i) => (Math.abs(luz[i + 1].media - luz[i].media) > 0.45 ? [`${clipes[i].id} → ${clipe.id}`] : []));
    registrar("visual/continuidade", "visual", "Continuidade visual", "recomendacao", saltos.length ? `Salto forte de claridade entre clipes vizinhos: ${saltos.join(", ")}.` : null,
      "Sem saltos fortes de claridade entre clipes vizinhos.", "Ajuste o brilho de um dos clipes ou troque a ordem.", { base: "estimado" });

    const textos = t.itens.filter((i): i is Extract<ItemDaTimeline, { tipo: "texto" }> => i.tipo === "texto" && !i.fundo);
    if (textos.length === 0) lista.push({ id: "visual/contraste-dos-textos", grupo: "visual", nome: "Contraste dos textos", gravidade: "recomendacao", situacao: "nao-aplicavel", detalhe: "Não há textos sem caixa de fundo.", sugestao: "", base: "observado" });
    else {
      const fracos: string[] = [];
      for (const x of textos) {
        const cor = luminanciaDaCor(x.cor);
        if (cor === null) continue;
        const fundo = (await amostrar(x.inicioSeg + x.duracaoSeg / 2))[x.posicao];
        const contraste = (Math.max(cor, fundo) + 0.05) / (Math.min(cor, fundo) + 0.05);
        if (contraste < 2.5) fracos.push(`"${x.texto.slice(0, 30)}" (contraste de ${arredondar(contraste, 1)} para 1 com a imagem atrás)`);
      }
      registrar("visual/contraste-dos-textos", "visual", "Contraste dos textos", "importante", fracos.length ? `Texto difícil de ler sobre a imagem: ${fracos.join(", ")}.` : null,
        "Os textos se destacam da imagem atrás deles.", "Dê ao texto uma caixa de fundo (campo \"fundo\") ou mude a cor ou a posição.", { base: "estimado" });
    }

    // --- Destino: abertura ----------------------------------------------------------------------------------------------
    if (!p.abertura.avaliar) lista.push({ id: "destino/abertura", grupo: "destino", nome: "Abertura", gravidade: "recomendacao", situacao: "nao-aplicavel", detalhe: `O destino ${p.nome} não exige abertura de impacto.`, sugestao: "", base: "observado" });
    else {
      const segundos = p.abertura.segundos;
      const movimento = Math.max(0, ...visual.sinais.atividadePorSegundo.slice(0, segundos));
      const apoio = t.itens.some((i) => (i.tipo === "texto" || i.tipo === "legenda") && i.inicioSeg < segundos) || visual.cortesSeg.some((corte) => corte < segundos);
      const pretoNoInicio = visual.sinais.pretos.some((x) => x.inicioSeg < 0.2);
      registrar("destino/abertura", "destino", "Abertura", pretoNoInicio ? "importante" : "recomendacao",
        pretoNoInicio ? "O vídeo começa em tela preta." : movimento < 1.5 && !apoio ? `Os primeiros ${segundos} s têm imagem parada, sem corte, texto ou fala.` : null,
        `Há movimento, corte, texto ou fala nos primeiros ${segundos} s.`, "Comece pelo trecho mais forte do material.", { base: "estimado", inicioSeg: 0, fimSeg: segundos });
    }

    // --- Áudio ----------------------------------------------------------------------------------------------------------------
    const esperaSom = t.itens.some((i) => (i.tipo === "video" && i.volume > 0) || i.tipo === "audio");
    registrar("audio/presenca", "audio", "Presença de áudio", "obrigatoria", esperaSom && !audio ? "A timeline tem som, mas o arquivo saiu sem faixa de áudio." : null, audio ? "O arquivo tem faixa de áudio." : "A timeline não tem som e o arquivo também não.", refazer);
    if (!audio || !som) return lista;
    registrar("audio/inaudivel", "audio", "Áudio audível", "importante", esperaSom && !som.audivel ? "A faixa de áudio existe, mas está em silêncio do início ao fim." : null, "O áudio é audível.", "Confira o volume dos clipes e da trilha.");

    const inicioV = Number(video.start_time ?? 0), inicioA = Number(audio.start_time ?? 0);
    const diferenca = Math.max(Math.abs(inicioV - inicioA), Math.abs(Number(video.duration ?? duracao) - Number(audio.duration ?? duracao)));
    registrar("audio/sincronia", "audio", "Sincronia entre áudio e vídeo", diferenca > 0.5 ? "obrigatoria" : "importante", diferenca > 0.12 ? `As faixas de áudio e de vídeo diferem em ${arredondar(diferenca)} s no início ou na duração.` : null,
      `Áudio e vídeo começam juntos e têm a mesma duração (diferença de ${arredondar(diferenca)} s).`, refazer);

    // Volume percebido e pico real, medidos pelo filtro ebur128 do FFmpeg.
    const medida = (await executarDetalhado(process.env.IAEV_FFMPEG ?? "ffmpeg", ["-hide_banner", "-nostats", "-i", arquivo, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"])).erro;
    const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(medida)?.[1] ?? NaN), pico = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(medida)?.[1] ?? NaN);
    if (som.audivel && Number.isFinite(lufs)) {
      registrar("audio/volume", "audio", "Volume", "recomendacao", Math.abs(lufs - p.audio.volumeAlvoLufs) > 6 ? `Volume percebido de ${lufs} LUFS; o usual para ${p.nome} fica perto de ${p.audio.volumeAlvoLufs} LUFS.` : null,
        `Volume percebido de ${lufs} LUFS, próximo do alvo de ${p.audio.volumeAlvoLufs}.`, lufs < p.audio.volumeAlvoLufs ? "Aumente o volume dos clipes ou da trilha." : "Reduza o volume dos clipes ou da trilha.");
      registrar("audio/picos", "audio", "Picos de volume", "importante", Number.isFinite(pico) && pico > p.audio.picoMaximoDb ? `Pico de ${pico} dBFS, acima do limite de ${p.audio.picoMaximoDb} dBFS: pode distorcer ao ser reproduzido.` : null,
        `Pico de ${pico} dBFS, dentro do limite.`, "Reduza o volume do item mais alto.");
    }
    registrar("audio/distorcao", "audio", "Distorção por estouro", "importante", som.estouro > 0.005 ? `${arredondar(som.estouro * 100, 1)}% das amostras estão no volume máximo: o som está estourado.` : null, "Sem sinais de estouro.", "Reduza o volume do item que está estourando ou use outro áudio.");

    const trilha = t.itens.some((i) => i.tipo === "audio" && i.papel === "trilha");
    const buracos = (som.silencios.valor ?? []).filter((s) => s.fimSeg - s.inicioSeg >= (trilha ? 0.5 : 1.5) && s.inicioSeg > 0.3 && s.fimSeg < duracao - 0.5);
    registrar("audio/cortes-de-audio", "audio", "Cortes inesperados no áudio", trilha ? "importante" : "recomendacao",
      som.audivel && buracos.length ? `Silêncio em ${buracos.slice(0, 6).map((s) => `${s.inicioSeg}–${s.fimSeg} s`).join(", ")}.` : null, "Sem buracos de silêncio no meio do vídeo.",
      trilha ? "Confira os fades e a duração da trilha." : "Considere uma trilha sonora ou som ambiente nesses trechos.", buracos[0] ? { inicioSeg: buracos[0].inicioSeg, fimSeg: buracos[0].fimSeg } : {});
    const audiveis = som.curvaDeIntensidadeDb.filter((v) => v > -45);
    const variacao = audiveis.length >= 4 ? Math.max(...audiveis) - Math.min(...audiveis) : 0;
    registrar("audio/diferencas-de-volume", "audio", "Diferenças de volume", "recomendacao", variacao > 24 ? `O volume varia ${arredondar(variacao, 0)} dB entre os trechos mais alto e mais baixo.` : null,
      "O volume se mantém equilibrado ao longo do vídeo.", "Aproxime o volume dos clipes (campo \"volume\") ou baixe a trilha nos trechos altos.");
    return lista;
  }
}
