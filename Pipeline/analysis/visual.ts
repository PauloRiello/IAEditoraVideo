// Análise visual por medição direta, sem modelo de IA.
//
// Amostragem: o vídeo é decodificado uma única vez, reduzido a 64×36 pixels e a no máximo
// 8 quadros por segundo (menos em vídeos longos, até um teto de 6000 quadros). Isso basta
// para medir cortes, transições, movimento, cor e luz, e custa uma fração de analisar
// todos os quadros em resolução cheia.

import { estimado, observado, type AnaliseVisual, type DadosTecnicos, type Movimento, type Plano, type Transicao } from "../../src/dominio/analise.ts";
import { arredondar, ffmpeg, mediana } from "./ferramentas.ts";

const L = 64;
const A = 36;
const PX = L * A;
const BYTES = PX * 3;
const MAX_QUADROS = 6000;
const PRETO = 16; // luminância média abaixo disso = quadro preto

export type MedicaoVisual = Omit<AnaliseVisual, "enquadramentos" | "efeitos" | "tipografia" | "legendas" | "animacoes"> & {
  /** Instantes dos cortes e transições, para comparar com o áudio. */
  cortesSeg: number[];
  /** Instante central dos planos escolhidos como quadros-chave. */
  temposDosQuadrosChave: number[];
};

export async function medirVisual(arquivo: string, tecnico: DadosTecnicos, quadrosChave = 8): Promise<MedicaoVisual> {
  const fps = arredondar(Math.max(1, Math.min(8, tecnico.fps || 8, MAX_QUADROS / Math.max(1, tecnico.duracaoSeg))), 3);
  const bruto = await ffmpeg(["-i", arquivo, "-an", "-vf", `fps=${fps},scale=${L}:${A}:flags=area,format=rgb24`, "-f", "rawvideo", "-"]);
  const n = Math.floor(bruto.length / BYTES);
  if (n < 2) throw new Error("O vídeo é curto demais para ser analisado.");

  // --- Estatísticas por quadro -------------------------------------------------
  const cinza = new Uint8Array(n * PX);
  const luma = new Float32Array(n);
  const contraste = new Float32Array(n);
  const saturacao = new Float32Array(n);
  const vermelho = new Float32Array(n);
  const azul = new Float32Array(n);
  const linhasEscuras = new Uint32Array(A);
  const histograma = new Uint32Array(64);
  let quadrosComImagem = 0;

  for (let i = 0; i < n; i += 1) {
    let somaY = 0, somaY2 = 0, somaS = 0, somaR = 0, somaB = 0;
    const linha = new Float32Array(A);
    for (let p = 0; p < PX; p += 1) {
      const o = i * BYTES + p * 3;
      const r = bruto[o], g = bruto[o + 1], b = bruto[o + 2];
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      cinza[i * PX + p] = y;
      somaY += y;
      somaY2 += y * y;
      const maximo = Math.max(r, g, b);
      somaS += maximo ? (maximo - Math.min(r, g, b)) / maximo : 0;
      somaR += r;
      somaB += b;
      linha[(p / L) | 0] += y;
      histograma[((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6)] += 1;
    }
    luma[i] = somaY / PX;
    contraste[i] = Math.sqrt(Math.max(0, somaY2 / PX - luma[i] ** 2));
    saturacao[i] = somaS / PX;
    vermelho[i] = somaR / PX;
    azul[i] = somaB / PX;
    if (luma[i] >= PRETO) {
      quadrosComImagem += 1;
      for (let y = 0; y < A; y += 1) if (linha[y] / L < 14) linhasEscuras[y] += 1;
    }
  }

  // --- Diferença entre quadros -------------------------------------------------
  const distancia = (a: number, b: number): number => {
    let soma = 0;
    for (let k = 0; k < BYTES; k += 1) soma += Math.abs(bruto[a * BYTES + k] - bruto[b * BYTES + k]);
    return soma / BYTES;
  };
  const diferencas = new Float32Array(n);
  for (let i = 1; i < n; i += 1) diferencas[i] = distancia(i, i - 1);

  // Corte seco: um salto isolado, bem acima do movimento ao redor.
  const eCorte = new Uint8Array(n);
  let ultimoCorte = -10;
  for (let i = 1; i < n; i += 1) {
    const d = diferencas[i];
    if (d < 10 || i - ultimoCorte < 2) continue;
    const vizinhos: number[] = [];
    for (let j = Math.max(1, i - 6); j <= Math.min(n - 1, i + 6); j += 1) if (j !== i) vizinhos.push(diferencas[j]);
    if (d > 3 * mediana(vizinhos) + 4 && d >= diferencas[i - 1] && d >= (diferencas[i + 1] ?? 0)) {
      eCorte[i] = 1;
      ultimoCorte = i;
    }
  }

  // Transição gradual: o quadro do meio é a mistura dos quadros das pontas (dissolução ou fade).
  // Em movimento de câmera isso não acontece, porque o conteúdo se desloca em vez de se misturar.
  const meiaJanela = Math.max(1, Math.round(fps * 0.375));
  const graduais: { primeiro: number; ultimo: number; preto: boolean }[] = [];
  for (let m = meiaJanela; m < n - meiaJanela; m += 1) {
    const a = m - meiaJanela, b = m + meiaJanela;
    let temCorte = false;
    for (let j = a + 1; j <= b; j += 1) if (eCorte[j]) temCorte = true;
    if (temCorte) continue;
    const total = distancia(a, b);
    if (total < 14) continue;
    let residuo = 0;
    for (let k = 0; k < BYTES; k += 1) residuo += Math.abs(bruto[m * BYTES + k] - (bruto[a * BYTES + k] + bruto[b * BYTES + k]) / 2);
    if (residuo / BYTES / total >= 0.3) continue;
    const preto = luma[a] < PRETO || luma[b] < PRETO;
    const anterior = graduais.at(-1);
    if (anterior && m - anterior.ultimo <= Math.round(fps * 1.5)) {
      // Mesma transição vista em janelas vizinhas (ou fade-out seguido de fade-in).
      anterior.ultimo = m;
      anterior.preto ||= preto;
    } else {
      graduais.push({ primeiro: m, ultimo: m, preto });
    }
  }
  // Fade que parte do preto no começo ou termina em preto no fim: abertura ou encerramento, não troca de plano.
  const naBorda = (g: { primeiro: number; ultimo: number; preto: boolean }) => {
    if (!g.preto) return false;
    let antes = true, depois = true;
    for (let i = 0; i < g.primeiro - meiaJanela; i += 1) if (luma[i] >= PRETO) antes = false;
    for (let i = g.ultimo + meiaJanela + 1; i < n; i += 1) if (luma[i] >= PRETO) depois = false;
    return antes || depois;
  };

  const transicoes: Transicao[] = [];
  for (let i = 1; i < n; i += 1) if (eCorte[i]) transicoes.push({ tempoSeg: arredondar(i / fps), tipo: "corte-seco", duracaoSeg: 0 });
  const bordas = new Set<number>();
  for (const g of graduais) {
    const tempoSeg = arredondar((g.primeiro + g.ultimo) / 2 / fps);
    transicoes.push({ tempoSeg, tipo: g.preto ? "fade-preto" : "gradual", duracaoSeg: arredondar(Math.max(2 * meiaJanela, g.ultimo - g.primeiro) / fps) });
    if (naBorda(g)) bordas.add(tempoSeg);
  }
  transicoes.sort((x, y) => x.tempoSeg - y.tempoSeg);

  // --- Planos e movimento ------------------------------------------------------
  const duracao = tecnico.duracaoSeg || n / fps;
  const limites = [0, ...transicoes.map((t) => t.tempoSeg).filter((t) => t > 0.3 && t < duracao - 0.3 && !bordas.has(t)), duracao];
  const planos: Plano[] = [];
  for (let k = 0; k < limites.length - 1; k += 1) {
    const inicio = limites[k], fim = limites[k + 1];
    planos.push({ inicioSeg: arredondar(inicio), fimSeg: arredondar(fim), duracaoSeg: arredondar(fim - inicio), movimento: null });
  }

  const passo = Math.max(2, Math.round(fps * 0.5));
  const tempoPorMovimento: Record<Movimento, number> = { estatico: 0, panoramica: 0, "zoom-in": 0, "zoom-out": 0, complexo: 0 };
  for (const plano of planos) {
    const contagem: Record<Movimento, number> = { estatico: 0, panoramica: 0, "zoom-in": 0, "zoom-out": 0, complexo: 0 };
    const primeiro = Math.ceil(plano.inicioSeg * fps) + 1, ultimo = Math.floor(plano.fimSeg * fps) - 1;
    for (let i = primeiro; i + passo <= Math.min(ultimo, n - 1); i += passo) {
      if (luma[i] < PRETO || luma[i + passo] < PRETO) continue;
      contagem[movimentoEntre(cinza, i, i + passo)] += 1;
    }
    const pares = Object.values(contagem).reduce((s, v) => s + v, 0);
    if (pares === 0) continue;
    plano.movimento = (Object.keys(contagem) as Movimento[]).reduce((x, y) => (contagem[y] > contagem[x] ? y : x));
    for (const tipo of Object.keys(contagem) as Movimento[]) tempoPorMovimento[tipo] += contagem[tipo];
  }
  const paresTotais = Object.values(tempoPorMovimento).reduce((s, v) => s + v, 0);
  const fracaoPorMovimento = Object.fromEntries(
    (Object.keys(tempoPorMovimento) as Movimento[]).map((tipo) => [tipo, paresTotais ? arredondar(tempoPorMovimento[tipo] / paresTotais) : 0]),
  ) as Record<Movimento, number>;

  // --- Ritmo -------------------------------------------------------------------
  const duracoes = planos.map((p) => p.duracaoSeg);
  const cortes = planos.length - 1;
  const porMinuto = (quantidade: number, segundos: number) => arredondar((quantidade / Math.max(0.001, segundos)) * 60, 1);
  const noTerco = (k: number) => porMinuto(limites.slice(1, -1).filter((t) => t >= (k * duracao) / 3 && t < ((k + 1) * duracao) / 3).length, duracao / 3);
  const porTerco: [number, number, number] = [noTerco(0), noTerco(1), noTerco(2)];
  const variacao = porTerco[2] - porTerco[0];
  // Com poucos cortes, a diferença entre os terços é ruído: exige ao menos 9 cortes e 40% de variação.
  const limiar = Math.max(4, 0.4 * porMinuto(cortes, duracao));
  const progressao = cortes < 9 || Math.abs(variacao) < limiar ? "constante" : variacao > 0 ? "acelera" : "desacelera";

  // --- Cor, luz e composição ---------------------------------------------------
  const media = (valores: Float32Array) => {
    let soma = 0, quantos = 0;
    for (let i = 0; i < n; i += 1) if (luma[i] >= PRETO) { soma += valores[i]; quantos += 1; }
    return quantos ? soma / quantos : 0;
  };
  const brilho = media(luma) / 255, contrasteMedio = media(contraste) / 255, saturacaoMedia = media(saturacao);
  const r = media(vermelho), b = media(azul);
  const calor = r + b > 0 ? (r - b) / (r + b) : 0;
  const faixa = (valor: number, baixo: number, alto: number, nomes: [string, string, string]) => (valor < baixo ? nomes[0] : valor > alto ? nomes[2] : nomes[1]);
  const totalPixels = n * PX;
  const coresDominantes = [...histograma.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 5)
    .filter(([, quantidade]) => quantidade / totalPixels >= 0.03)
    .map(([caixa, quantidade]) => {
      const canal = (nivel: number) => (nivel * 64 + 32).toString(16).padStart(2, "0");
      return { hex: `#${canal(caixa >> 4)}${canal((caixa >> 2) & 3)}${canal(caixa & 3)}`, fracao: arredondar(quantidade / totalPixels) };
    });

  const escura = (y: number) => quadrosComImagem > 0 && linhasEscuras[y] / quadrosComImagem >= 0.92;
  let topo = 0, base = 0;
  while (topo < A / 2 && escura(topo)) topo += 1;
  while (base < A / 2 && escura(A - 1 - base)) base += 1;
  const barras = topo >= 2 && base >= 2 && Math.abs(topo - base) <= 2;
  const proporcaoUtil = barras ? `${arredondar((tecnico.largura / tecnico.altura) * (A / (A - topo - base)), 2)}:1` : tecnico.proporcao;

  // --- Quadros-chave: o instante central de até N planos, espalhados pelo vídeo ---
  const escolhidos = planos.length <= quadrosChave ? planos : Array.from({ length: quadrosChave }, (_, k) => planos[Math.floor((k * planos.length) / quadrosChave)]);

  const metodo = `medição em ${n} quadros de ${L}×${A} a ${fps} quadros/s`;
  const confiancaRitmo = Math.min(0.95, 0.5 + cortes / 30);
  return {
    amostragem: {
      quadrosPorSegundo: fps, resolucao: `${L}x${A}`, quadrosAnalisados: n,
      quadrosDoVideo: Math.round(duracao * (tecnico.fps || fps)), quadrosChave: [],
    },
    planos,
    transicoes,
    ritmo: observado(
      {
        planos: planos.length, cortesPorMinuto: porMinuto(cortes, duracao),
        duracaoMediaSeg: arredondar(duracao / planos.length), duracaoMedianaSeg: arredondar(mediana(duracoes)),
        duracaoMinimaSeg: Math.min(...duracoes), duracaoMaximaSeg: Math.max(...duracoes), porTerco, progressao,
      },
      `${metodo}; corte = salto isolado de diferença entre quadros`, confiancaRitmo,
    ),
    tiposDeTransicao: observado(
      {
        "corte-seco": transicoes.filter((t) => t.tipo === "corte-seco").length,
        gradual: transicoes.filter((t) => t.tipo === "gradual").length,
        "fade-preto": transicoes.filter((t) => t.tipo === "fade-preto").length,
      },
      `${metodo}; transição gradual = quadro intermediário igual à mistura dos vizinhos`, 0.75,
    ),
    movimentoDeCamera: estimado(fracaoPorMovimento, "deslocamento e escala que melhor alinham quadros a 0,5 s de distância, em baixa resolução", paresTotais ? 0.55 : 0),
    cor: observado(
      {
        saturacao: arredondar(saturacaoMedia), classificacaoSaturacao: faixa(saturacaoMedia, 0.25, 0.5, ["baixa", "media", "alta"]),
        temperatura: faixa(calor, -0.06, 0.06, ["fria", "neutra", "quente"]), coresDominantes,
      },
      metodo, 0.85,
    ),
    iluminacao: observado(
      {
        brilho: arredondar(brilho), contraste: arredondar(contrasteMedio),
        classificacaoBrilho: faixa(brilho, 0.3, 0.6, ["escura", "media", "clara"]),
        classificacaoContraste: faixa(contrasteMedio, 0.15, 0.27, ["baixo", "medio", "alto"]),
      },
      metodo, 0.85,
    ),
    composicao: observado({ barrasDeCinema: barras, proporcaoUtil }, `${metodo}; barras = faixas escuras fixas em cima e embaixo`, 0.8),
    cortesSeg: limites.slice(1, -1),
    temposDosQuadrosChave: escolhidos.map((p) => arredondar((p.inicioSeg + p.fimSeg) / 2)),
  };
}

/** Classifica o movimento entre dois quadros em tons de cinza procurando o deslocamento e a escala que melhor os alinham. */
function movimentoEntre(cinza: Uint8Array, a: number, b: number): Movimento {
  const erro = (dx: number, dy: number, escala: number): number => {
    let soma = 0, quantos = 0;
    for (let y = 4; y < A - 4; y += 1) {
      for (let x = 6; x < L - 6; x += 1) {
        const xo = Math.round(L / 2 + (x - L / 2) / escala + dx), yo = Math.round(A / 2 + (y - A / 2) / escala + dy);
        if (xo < 0 || xo >= L || yo < 0 || yo >= A) continue;
        soma += Math.abs(cinza[b * PX + y * L + x] - cinza[a * PX + yo * L + xo]);
        quantos += 1;
      }
    }
    return quantos ? soma / quantos : Infinity;
  };
  const parado = erro(0, 0, 1);
  if (parado < 1.2) return "estatico";

  let melhor = parado, melhorEscala = 1, deslocou = false;
  for (let dx = -5; dx <= 5; dx += 1) {
    for (let dy = -3; dy <= 3; dy += 1) {
      const e = erro(dx, dy, 1);
      if (e < melhor) { melhor = e; melhorEscala = 1; deslocou = dx !== 0 || dy !== 0; }
    }
  }
  for (const escala of [0.9, 0.95, 1.05, 1.1]) {
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const e = erro(dx, dy, escala);
        if (e < melhor * 0.92) { melhor = e; melhorEscala = escala; }
      }
    }
  }
  if ((parado - melhor) / parado < 0.35) return "complexo";
  if (melhorEscala > 1) return "zoom-in";
  if (melhorEscala < 1) return "zoom-out";
  return deslocou ? "panoramica" : "complexo";
}
