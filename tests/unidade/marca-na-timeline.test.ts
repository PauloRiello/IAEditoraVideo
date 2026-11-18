// Marca aplicada na timeline: logo, cores, fontes, contraste, encerramento e reaplicação.

import assert from "node:assert/strict";
import { test } from "node:test";
import { aplicarMarca, contraste, removerMarca, type RetratoDaMarca } from "../../src/dominio/marca-na-timeline.ts";
import type { ItemDaTimeline, Timeline } from "../../src/dominio/timeline.ts";
import { aplicarOperacao, normalizarTimeline } from "../../src/servicos/timeline.ts";

const CENTRO = { modo: "preencher" as const, x: 0.5, y: 0.5, zoom: 1 };
function base(o: { vertical?: boolean; caixa?: boolean; comCartao?: boolean } = {}): Timeline {
  const itens: ItemDaTimeline[] = [
    { id: "clipe-1", tipo: "video", camada: 0, inicioSeg: 0, duracaoSeg: 10, arquivo: "/v/a.mp4", inicioOrigemSeg: 0, velocidade: 1, volume: 1, enquadramento: CENTRO, entrada: { tipo: "corte", duracaoSeg: 0 }, saida: { tipo: "corte", duracaoSeg: 0 }, efeitos: [] } as ItemDaTimeline,
    { id: "texto-1", tipo: "texto", camada: 20, inicioSeg: 1, duracaoSeg: 3, texto: "Fato", posicao: "base", tamanho: 0.05, cor: "#ffffff", fundo: "", animacao: "surgir" },
    { id: "texto-cta", tipo: "texto", camada: 20, inicioSeg: 7, duracaoSeg: 3, texto: "Entre no Discord", posicao: "centro", tamanho: 0.05, cor: "#ffffff", fundo: "rgba(0,0,0,0.6)", animacao: "subir" },
    { id: "legenda-1", tipo: "legenda", camada: 10, inicioSeg: 2, duracaoSeg: 2, texto: "olá" },
    { id: "trilha", tipo: "audio", papel: "trilha", camada: 0, arquivo: "/a/t.mp3", inicioSeg: 0, duracaoSeg: 10, inicioOrigemSeg: 0, volume: 0.6, fadeDeEntradaSeg: 0.3, fadeDeSaidaSeg: 1, reduzirEm: [], volumeReduzido: 0.3 },
  ];
  if (o.comCartao) {
    itens.push({ id: "cartao-final", tipo: "cartao", camada: 0, inicioSeg: 10, duracaoSeg: 2.5, titulo: "Entre", subtitulo: "Projeto", corDeFundo: "#0e1116", corDoTexto: "#ffffff", enquadramento: { ...CENTRO, modo: "conter" }, entrada: { tipo: "gradual", duracaoSeg: 0.3 }, saida: { tipo: "corte", duracaoSeg: 0 }, efeitos: [] });
  }
  return normalizarTimeline({
    versao: 1, formato: o.vertical ? { largura: 1080, altura: 1920, fps: 30 } : { largura: 1920, altura: 1080, fps: 30 }, duracaoSeg: o.comCartao ? 12.5 : 10, itens, efeitosGlobais: [],
    legendas: { tamanho: 0.034, caixa: o.caixa ?? true }, areaSegura: o.vertical ? { topo: 0.1, base: 0.2, lados: 0.05 } : { topo: 0.05, base: 0.05, lados: 0.04 },
  });
}
const marca = (cores: { hex: string; papel: RetratoDaMarca["cores"][number]["papel"] }[], extra: Partial<RetratoDaMarca> = {}): RetratoDaMarca => ({
  id: "m1", atualizadaEm: "2026-11-18T10:00:00Z", logo: "/m/logo.png", logoClaro: null,
  logoPosicao: { canto: "superior-direito", alturaRelativa: 0.08, opacidade: 0.85 },
  cores: cores.map((c) => ({ ...c, base: "observado" as const, fonte: "manual, página 1" })),
  fontes: { titulos: { nome: "Montserrat", arquivos: ["/m/Montserrat-400.woff2"], origem: "google-fonts", licenca: "OFL" }, texto: { nome: "Marca Sans", arquivos: [], origem: "pendente", licenca: "" } },
  ...extra,
});
const AZUL = marca([{ hex: "#1A2B3C", papel: "primaria" }, { hex: "#FFFFFF", papel: "texto" }]);
const item = (t: Timeline, id: string) => t.itens.find((i) => i.id === id) as Record<string, unknown> & ItemDaTimeline;

test("logo de canto, cores e fontes aplicados, com decisões de origem marca", () => {
  const { timeline: t, decisoes } = aplicarMarca(base(), AZUL);
  const logo = item(t, "logo-da-marca") as Extract<ItemDaTimeline, { tipo: "imagem" }>;
  assert.equal(logo.tipo, "imagem");
  assert.equal(logo.origem, "marca");
  assert.equal(logo.arquivo, "/m/logo.png");
  assert.deepEqual(logo.sobreposicao, { x: 0.66, y: 0.05, largura: 0.3, altura: 0.08, opacidade: 0.85, alinhamento: "direita" });
  assert.equal(t.legendas.fundo, "#1A2B3CD9");
  assert.equal(t.legendas.cor, "#FFFFFF");
  assert.equal(t.legendas.fonte, undefined, "fonte de texto pendente: fica a padrão");
  assert.equal(item(t, "texto-cta").fundo, "#1A2B3CD9");
  assert.equal(item(t, "texto-cta").fonte, "Montserrat");
  assert.equal(item(t, "texto-1").cor, "#ffffff", "texto sem caixa continua branco");
  assert.equal(item(t, "texto-1").fonte, "Montserrat");
  assert.deepEqual(t.marca, { id: "m1", atualizadaEm: "2026-11-18T10:00:00Z", fontes: [{ familia: "Montserrat", arquivo: "/m/Montserrat-400.woff2" }] });
  assert.ok(decisoes.length >= 4 && decisoes.every((d) => d.origem === "marca"));
});

test("amarelo com branco: a legenda sai legível e a decisão explica", () => {
  assert.ok(contraste("#FFFF00", "#FFFFFF") < 4.5);
  assert.ok(Math.abs(contraste("#000000", "#FFFFFF") - 21) < 0.01);
  const { timeline: t, decisoes } = aplicarMarca(base(), marca([{ hex: "#FFFF00", papel: "primaria" }, { hex: "#FFFFFF", papel: "texto" }]));
  assert.equal(t.legendas.cor, "#000000");
  assert.ok(decisoes.some((d) => /sem contraste suficiente: usado #000000/.test(d.decisao)), JSON.stringify(decisoes));
});

test("estilo sem caixa: a legenda continua sem caixa, só a fonte muda", () => {
  const comFonte = marca([{ hex: "#1A2B3C", papel: "primaria" }], { fontes: { titulos: null, texto: { nome: "Inter", arquivos: ["/m/inter.woff2"], origem: "enviada", licenca: "x" } } });
  const { timeline: t } = aplicarMarca(base({ caixa: false }), comFonte);
  assert.equal(t.legendas.caixa, false);
  assert.equal(t.legendas.fundo, undefined);
  assert.equal(t.legendas.cor, undefined);
  assert.equal(t.legendas.fonte, "Inter");
});

test("sem cartão final: encerramento de 2 s com o logo; com cartão, o logo entra nele", () => {
  const { timeline: t } = aplicarMarca(base(), AZUL);
  const fim = item(t, "encerramento-da-marca") as Extract<ItemDaTimeline, { tipo: "cartao" }>;
  assert.equal(fim.tipo, "cartao");
  assert.equal(fim.duracaoSeg, 2);
  assert.equal(fim.inicioSeg, 10);
  assert.equal(fim.logo, "/m/logo.png");
  assert.equal(fim.corDeFundo, "#1A2B3C");
  assert.equal(fim.saida.tipo, "fade");
  assert.equal(t.duracaoSeg, 12);
  assert.equal(item(t, "trilha").duracaoSeg, 12, "a trilha acompanha o encerramento");
  assert.equal(item(t, "logo-da-marca").duracaoSeg, 10, "o logo de canto não fica por cima do encerramento");

  const comCartao = aplicarMarca(base({ comCartao: true }), AZUL).timeline;
  assert.equal(comCartao.itens.some((i) => i.id === "encerramento-da-marca"), false);
  assert.equal(item(comCartao, "cartao-final").logo, "/m/logo.png");
  assert.equal(item(comCartao, "cartao-final").corDeFundo, "#1A2B3C");
  assert.equal(item(comCartao, "cartao-final").fonte, "Montserrat");
});

test("vertical: logo no topo, dentro da área segura, mesmo pedindo um canto de baixo", () => {
  const embaixo = marca([{ hex: "#1A2B3C", papel: "primaria" }], { logoPosicao: { canto: "inferior-direito", alturaRelativa: 0.06, opacidade: 1 } });
  const { timeline: t, decisoes } = aplicarMarca(base({ vertical: true }), embaixo);
  const s = (item(t, "logo-da-marca") as Extract<ItemDaTimeline, { tipo: "imagem" }>).sobreposicao!;
  assert.equal(s.y, 0.1);
  assert.ok(Math.abs(s.x + s.largura - 0.95) < 1e-9);
  assert.ok(decisoes.some((d) => /topo/.test(d.decisao)));
});

test("marca editada: a timeline montada não muda; aplicar-marca troca só o da marca e mantém as edições", () => {
  const montada = aplicarMarca(base(), AZUL).timeline;
  const copia = structuredClone(montada);
  let editada = aplicarOperacao(montada, { tipo: "alterar", id: "texto-cta", campos: { texto: "Texto novo", cor: "#FF00FF" } });
  editada = aplicarOperacao(editada, { tipo: "cortar", id: "clipe-1", fimSeg: 8 });
  const verde = marca([{ hex: "#00AA00", papel: "primaria" }, { hex: "#000000", papel: "texto" }], { atualizadaEm: "2026-11-19T10:00:00Z" });
  const reaplicada = aplicarOperacao(editada, { tipo: "aplicar-marca", marca: verde });
  assert.deepEqual(montada, copia, "a timeline montada não foi tocada");
  assert.equal(reaplicada.legendas.fundo, "#00AA00D9");
  assert.equal(item(reaplicada, "texto-cta").texto, "Texto novo");
  assert.equal(item(reaplicada, "texto-cta").cor, "#FF00FF", "cor mudada à mão continua");
  assert.equal(item(reaplicada, "texto-cta").fundo, "#00AA00D9");
  assert.equal(item(reaplicada, "clipe-1").duracaoSeg, 8, "o corte manual continua");
  assert.equal(reaplicada.itens.filter((i) => i.id === "logo-da-marca").length, 1);
  assert.equal(reaplicada.marca?.atualizadaEm, "2026-11-19T10:00:00Z");
});

test("fonte pendente: o vídeo usa a padrão e a decisão registra", () => {
  const { decisoes } = aplicarMarca(base(), AZUL);
  assert.ok(decisoes.some((d) => /Marca Sans.*pendente/.test(d.decisao)), JSON.stringify(decisoes));
});

test("retirar a marca devolve a timeline de antes", () => {
  const original = base();
  assert.deepEqual(removerMarca(aplicarMarca(original, AZUL).timeline), original);
});
