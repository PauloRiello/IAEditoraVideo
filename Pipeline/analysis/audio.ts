// Análise de áudio por medição direta do sinal: volume, silêncios, mudanças de
// intensidade, ataques sonoros (batidas) e sincronia com os cortes.

import { estimado, observado, type AnaliseAudio, type Intervalo, type MudancaDeIntensidade } from "../../src/dominio/analise.ts";
import { arredondar, ffmpeg } from "./ferramentas.ts";

const TAXA = 8000; // amostras por segundo: suficiente para envelope de volume e ataques
const SALTO = 160; // 20 ms por janela
const JANELA_SEG = SALTO / TAXA;
const SILENCIO_DB = -45;
const TOLERANCIA_SEG = 0.13; // um corte "cai na batida" se estiver a até 130 ms de um ataque

export type MedicaoAudio = Pick<
  AnaliseAudio,
  "volume" | "silencios" | "mudancasDeIntensidade" | "curvaDeIntensidadeDb" | "batidas" | "pontosDeCorteMusical" | "sincroniaComCortes" | "trilhaSonora"
> & { audivel: boolean };

export async function medirAudio(arquivo: string, cortesSeg: number[]): Promise<MedicaoAudio> {
  const bruto = await ffmpeg(["-i", arquivo, "-vn", "-ac", "1", "-ar", String(TAXA), "-f", "s16le", "-"]);
  const amostras = new Int16Array(bruto.buffer, bruto.byteOffset, bruto.length >> 1);
  const n = Math.floor(amostras.length / SALTO);
  const duracao = n * JANELA_SEG;

  // Volume de cada janela de 20 ms, em dB relativos ao máximo digital (dBFS).
  const db = new Float32Array(n);
  let energiaTotal = 0, pico = 0;
  for (let i = 0; i < n; i += 1) {
    let energia = 0;
    for (let k = 0; k < SALTO; k += 1) {
      const v = amostras[i * SALTO + k] / 32768;
      energia += v * v;
      if (Math.abs(v) > pico) pico = Math.abs(v);
    }
    energiaTotal += energia;
    db[i] = 10 * Math.log10(energia / SALTO + 1e-10);
  }
  const sonoras = [...db].filter((v) => v > SILENCIO_DB).sort((x, y) => x - y);
  const percentil = (p: number) => (sonoras.length ? sonoras[Math.min(sonoras.length - 1, Math.floor(p * sonoras.length))] : SILENCIO_DB);
  const audivel = sonoras.length / Math.max(1, n) > 0.02;

  // Silêncios de pelo menos 0,4 s.
  const silencios: Intervalo[] = [];
  for (let i = 0; i < n; ) {
    if (db[i] > SILENCIO_DB) { i += 1; continue; }
    let j = i;
    while (j < n && db[j] <= SILENCIO_DB) j += 1;
    if ((j - i) * JANELA_SEG >= 0.4) silencios.push({ inicioSeg: arredondar(i * JANELA_SEG), fimSeg: arredondar(j * JANELA_SEG) });
    i = j;
  }

  // Volume médio por segundo e mudanças bruscas (2 s antes contra 2 s depois).
  const porSegundo: number[] = [];
  const janelasPorSegundo = Math.round(1 / JANELA_SEG);
  for (let s = 0; s * janelasPorSegundo < n; s += 1) {
    let energia = 0, quantas = 0;
    for (let i = s * janelasPorSegundo; i < Math.min(n, (s + 1) * janelasPorSegundo); i += 1) { energia += 10 ** (db[i] / 10); quantas += 1; }
    porSegundo.push(arredondar(10 * Math.log10(energia / quantas + 1e-10), 1));
  }
  const mediaDe = (inicio: number, fim: number) => {
    const trecho = porSegundo.slice(Math.max(0, inicio), Math.min(porSegundo.length, fim));
    return trecho.length ? 10 * Math.log10(trecho.reduce((s, v) => s + 10 ** (v / 10), 0) / trecho.length) : SILENCIO_DB;
  };
  const mudancas: MudancaDeIntensidade[] = [];
  for (let s = 2; s <= porSegundo.length - 2; s += 1) {
    const variacao = mediaDe(s, s + 2) - mediaDe(s - 2, s);
    if (Math.abs(variacao) < 8) continue;
    const anterior = mudancas.at(-1);
    const tipo = variacao > 0 ? "aumento" : "queda";
    if (anterior && s - anterior.tempoSeg <= 2 && anterior.tipo === tipo) {
      if (Math.abs(variacao) > Math.abs(anterior.variacaoDb)) Object.assign(anterior, { tempoSeg: s, variacaoDb: arredondar(variacao, 1) });
    } else {
      mudancas.push({ tempoSeg: s, tipo, variacaoDb: arredondar(variacao, 1) });
    }
  }

  // Ataques: subidas bruscas de volume, acima do que é normal ao redor.
  const novidade = new Float32Array(n);
  for (let i = 1; i < n; i += 1) novidade[i] = db[i] > SILENCIO_DB ? Math.max(0, db[i] - Math.max(db[i - 1], SILENCIO_DB)) : 0;
  const ataques: { tempoSeg: number; forca: number }[] = [];
  for (let i = 1; i < n - 1; i += 1) {
    if (novidade[i] < 3 || novidade[i] < novidade[i - 1] || novidade[i] < novidade[i + 1]) continue;
    let soma = 0, soma2 = 0, quantos = 0;
    for (let j = Math.max(0, i - 25); j < Math.min(n, i + 25); j += 1) { soma += novidade[j]; soma2 += novidade[j] ** 2; quantos += 1; }
    const mediaLocal = soma / quantos;
    if (novidade[i] < mediaLocal + 1.5 * Math.sqrt(Math.max(0, soma2 / quantos - mediaLocal ** 2))) continue;
    const anterior = ataques.at(-1);
    if (anterior && i * JANELA_SEG - anterior.tempoSeg < 0.1) {
      if (novidade[i] > anterior.forca) Object.assign(anterior, { tempoSeg: arredondar(i * JANELA_SEG), forca: novidade[i] });
    } else {
      ataques.push({ tempoSeg: arredondar(i * JANELA_SEG), forca: novidade[i] });
    }
  }

  // Andamento: o intervalo em que os ataques mais se repetem (entre 50 e 200 batidas por minuto).
  let mediaNovidade = 0;
  for (let i = 0; i < n; i += 1) mediaNovidade += novidade[i] / Math.max(1, n);
  const autocorrelacao = (atraso: number) => {
    let soma = 0;
    for (let i = atraso; i < n; i += 1) soma += (novidade[i] - mediaNovidade) * (novidade[i - atraso] - mediaNovidade);
    return soma;
  };
  const base = autocorrelacao(0);
  let melhorAtraso = 0, melhorValor = 0;
  if (base > 0 && ataques.length >= 8) {
    for (let atraso = Math.round(60 / 200 / JANELA_SEG); atraso <= Math.round(60 / 50 / JANELA_SEG); atraso += 1) {
      const valor = autocorrelacao(atraso) / base;
      if (valor > melhorValor * 1.05) { melhorValor = valor; melhorAtraso = atraso; }
    }
  }
  const regularidade = arredondar(Math.max(0, melhorValor));
  const temRitmo = regularidade >= 0.3;

  // Sincronia: quantos cortes caem perto de um ataque, comparado com o que aconteceria por acaso.
  const tempos = ataques.map((a) => a.tempoSeg);
  const naBatida = cortesSeg.filter((corte) => tempos.some((t) => Math.abs(t - corte) <= TOLERANCIA_SEG)).length;
  const aoAcaso = Math.min(1, (ataques.length * 2 * TOLERANCIA_SEG) / Math.max(0.001, duracao));
  const forcaMediana = [...ataques].sort((x, y) => x.forca - y.forca)[ataques.length >> 1]?.forca ?? 0;

  const metodo = `medição do sinal de áudio em janelas de ${JANELA_SEG * 1000} ms`;
  return {
    audivel,
    volume: observado(
      {
        picoDb: arredondar(20 * Math.log10(pico + 1e-10), 1),
        medioDb: arredondar(10 * Math.log10(energiaTotal / Math.max(1, n * SALTO) + 1e-10), 1),
        faixaDinamicaDb: arredondar(percentil(0.95) - percentil(0.1), 1),
      },
      `${metodo}; valores em dBFS, não em LUFS`,
    ),
    silencios: observado(silencios, `${metodo}; silêncio = abaixo de ${SILENCIO_DB} dBFS por 0,4 s ou mais`),
    mudancasDeIntensidade: observado(mudancas, `${metodo}; mudança = 8 dB ou mais entre os 2 s anteriores e os 2 s seguintes`, 0.8),
    curvaDeIntensidadeDb: porSegundo,
    batidas: observado(
      { ataques: ataques.length, regularidade, bpm: temRitmo ? Math.round(60 / (melhorAtraso * JANELA_SEG)) : null },
      `${metodo}; ataque = subida brusca de volume; andamento pela repetição dos ataques`,
      temRitmo ? Math.min(0.9, 0.4 + regularidade) : 0.5,
    ),
    pontosDeCorteMusical: estimado(
      ataques.filter((a) => a.forca >= forcaMediana).map((a) => a.tempoSeg).slice(0, 300),
      "ataques sonoros mais fortes que a mediana",
      temRitmo ? 0.6 : 0.35,
    ),
    sincroniaComCortes: observado(
      { cortesNaBatida: naBatida, cortesAvaliados: cortesSeg.length, fracao: cortesSeg.length ? arredondar(naBatida / cortesSeg.length) : 0, fracaoEsperadaAoAcaso: arredondar(aoAcaso) },
      `corte a até ${TOLERANCIA_SEG * 1000} ms de um ataque sonoro`,
      Math.min(0.9, 0.3 + cortesSeg.length / 20),
    ),
    trilhaSonora: !audivel
      ? estimado("ausente", "áudio inaudível", 0.8)
      : temRitmo
        ? estimado(`presente, com pulso regular de cerca de ${Math.round(60 / (melhorAtraso * JANELA_SEG))} batidas por minuto`, "regularidade dos ataques sonoros", Math.min(0.75, 0.35 + regularidade))
        : estimado("sem pulso regular: pode ser fala, ambiente ou música sem batida marcada", "regularidade dos ataques sonoros", 0.4),
  };
}
