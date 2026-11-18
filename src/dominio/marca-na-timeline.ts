// Aplicação da marca numa timeline: só dados, sem arquivos nem banco. Usada pela montagem e
// pela operação "aplicar-marca". A marca decide cor, fonte e logo; o estilo e a memória
// continuam decidindo caixa da legenda, posição, tamanhos e animações. Tudo o que a marca muda
// fica marcado (origem "marca" ou daMarca) para poder ser trocado sem tocar nas edições manuais.

import type { Marca } from "./marca.ts";
import type { Decisao } from "./producao.ts";
import type { ItemCartao, ItemDaTimeline, ItemImagem, Timeline } from "./timeline.ts";

/** O que da marca entra na timeline (com os arquivos já copiados para o projeto). */
export type RetratoDaMarca = Pick<Marca, "id" | "atualizadaEm" | "logo" | "logoClaro" | "logoPosicao" | "cores" | "fontes">;

const arredondar = (n: number) => Math.round(n * 10000) / 10000;
const ENCERRAMENTO_SEG = 2;
const LARGURA_MAXIMA_DO_LOGO = 0.3;

function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste WCAG entre duas cores #RRGGBB (de 1 a 21). */
export function contraste(a: string, b: string): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
}

/** Fim da faixa principal sem o que veio da marca (é onde o vídeo do usuário termina). */
function fimDoVideo(t: Timeline): number {
  const principais = t.itens.filter((i) => i.camada === 0 && i.origem !== "marca" && (i.tipo === "video" || i.tipo === "imagem" || i.tipo === "cartao"));
  const lista = principais.length ? principais : t.itens.filter((i) => i.origem !== "marca");
  return arredondar(Math.max(0, ...lista.map((i) => i.inicioSeg + i.duracaoSeg)));
}

/** Retira tudo o que veio da marca, devolvendo os valores de antes. Não altera a recebida. */
export function removerMarca(original: Timeline): Timeline {
  const t = structuredClone(original);
  t.itens = t.itens.filter((i) => i.origem !== "marca");
  for (const item of t.itens) {
    if (!item.daMarca) continue;
    const registro = item as unknown as Record<string, unknown>;
    for (const [campo, valor] of Object.entries(item.daMarca)) {
      if (valor === undefined) delete registro[campo];
      else registro[campo] = valor;
    }
    delete item.daMarca;
  }
  if (t.legendas.daMarca) {
    const legendas = t.legendas as Record<string, unknown>;
    for (const [campo, valor] of Object.entries(t.legendas.daMarca)) {
      if (valor === undefined) delete legendas[campo];
      else legendas[campo] = valor;
    }
    delete t.legendas.daMarca;
  }
  delete t.marca;
  t.duracaoSeg = fimDoVideo(t);
  return t;
}

/** Muda um campo guardando o valor de antes (só na primeira vez). */
function definir(alvo: { daMarca?: Record<string, unknown>; editadoAMao?: string[] }, campo: string, valor: unknown): void {
  if (alvo.editadoAMao?.includes(campo)) return; // a escolha do usuário vale mais que a marca
  const registro = alvo as Record<string, unknown>;
  alvo.daMarca ??= {};
  if (!(campo in alvo.daMarca)) alvo.daMarca[campo] = registro[campo];
  registro[campo] = valor;
}

export function aplicarMarca(original: Timeline, marca: RetratoDaMarca): { timeline: Timeline; decisoes: Decisao[] } {
  const t = removerMarca(original);
  const decisoes: Decisao[] = [];
  const decidir = (aspecto: string, decisao: string) => decisoes.push({ aspecto: `marca/${aspecto}`, decisao, origem: "marca" });
  const primaria = (marca.cores.find((c) => c.papel === "primaria") ?? marca.cores[0])?.hex;
  const corDeTexto = marca.cores.find((c) => c.papel === "texto")?.hex;
  /** Cor do texto sobre um fundo da marca: a da marca se for legível; senão branco ou preto. */
  const textoSobre = (fundo: string, onde: string): string => {
    if (corDeTexto && contraste(corDeTexto, fundo) >= 4.5) return corDeTexto;
    const legivel = contraste("#FFFFFF", fundo) >= contraste("#000000", fundo) ? "#FFFFFF" : "#000000";
    if (corDeTexto) decidir("contraste", `${onde}: cor da marca sem contraste suficiente: usado ${legivel}`);
    return legivel;
  };
  const caixa = primaria ? `${primaria}D9` : null; // cor primária quase opaca (alfa 0,85)

  // --- Fontes (só as que têm arquivo; pendente fica na padrão) ---------------------------------
  const fonte = (papel: "titulos" | "texto"): string | undefined => {
    const f = marca.fontes[papel];
    if (!f) return undefined;
    if (f.origem === "pendente" || f.arquivos.length === 0) {
      decidir(`fonte/${papel}`, `fonte ${f.nome} pendente: usada a fonte padrão`);
      return undefined;
    }
    decidir(`fonte/${papel}`, `fonte ${f.nome} ${papel === "titulos" ? "nos títulos e cartões" : "nas legendas"}`);
    return f.nome;
  };
  const fonteDosTitulos = fonte("titulos");
  const fonteDoTexto = fonte("texto");
  const arquivosDeFonte = (["titulos", "texto"] as const).flatMap((papel) => {
    const f = marca.fontes[papel];
    return f && f.origem !== "pendente" ? f.arquivos.map((arquivo) => ({ familia: f.nome, arquivo })) : [];
  });
  t.marca = { id: marca.id, atualizadaEm: marca.atualizadaEm, fontes: arquivosDeFonte.filter((f, i, todos) => todos.findIndex((o) => o.arquivo === f.arquivo) === i) };

  // --- Legendas: cor só com caixa; fonte sempre ------------------------------------------------
  if (t.legendas.caixa && primaria && caixa) {
    definir(t.legendas, "fundo", caixa);
    definir(t.legendas, "cor", textoSobre(primaria, "legenda"));
    decidir("legendas", `caixa da legenda na cor primária ${primaria}`);
  }
  if (fonteDoTexto) definir(t.legendas, "fonte", fonteDoTexto);

  // --- Textos na tela e cartões existentes -----------------------------------------------------
  const escuro = primaria ? luminancia(primaria) < 0.4 : true;
  const logoNoCartao = (escuro ? marca.logoClaro : null) ?? marca.logo;
  for (const item of t.itens) {
    if (item.tipo === "texto") {
      if (fonteDosTitulos) definir(item, "fonte", fonteDosTitulos);
      if (item.fundo && primaria && caixa) {
        definir(item, "fundo", caixa);
        definir(item, "cor", textoSobre(primaria, `texto "${item.texto.slice(0, 30)}"`));
      }
    } else if (item.tipo === "cartao" && primaria) {
      definir(item, "corDeFundo", primaria);
      definir(item, "corDoTexto", textoSobre(primaria, "cartão final"));
      if (logoNoCartao) definir(item, "logo", logoNoCartao);
      if (fonteDosTitulos) definir(item, "fonte", fonteDosTitulos);
      decidir("cartao", "logo e cores da marca no cartão final");
    }
  }

  // --- Encerramento curto com o logo, quando não há cartão final ---------------------------------
  const fim = fimDoVideo(t);
  const temCartao = t.itens.some((i) => i.tipo === "cartao");
  if (!temCartao && marca.logo && primaria) {
    const encerramento: ItemCartao = {
      id: "encerramento-da-marca", tipo: "cartao", camada: 0, inicioSeg: fim, duracaoSeg: ENCERRAMENTO_SEG, titulo: "", subtitulo: "",
      corDeFundo: primaria, corDoTexto: textoSobre(primaria, "encerramento"), logo: logoNoCartao ?? marca.logo, ...(fonteDosTitulos ? { fonte: fonteDosTitulos } : {}),
      enquadramento: { modo: "conter", x: 0.5, y: 0.5, zoom: 1 }, entrada: { tipo: "gradual", duracaoSeg: 0.3 }, saida: { tipo: "fade", duracaoSeg: 0.5 }, efeitos: [], origem: "marca",
    };
    t.itens.push(encerramento);
    for (const item of t.itens) if (item.tipo === "audio" && item.papel === "trilha") definir(item, "duracaoSeg", arredondar(item.duracaoSeg + ENCERRAMENTO_SEG));
    decidir("encerramento", `encerramento de ${ENCERRAMENTO_SEG} s com o logo (o vídeo não tinha cartão final)`);
  }

  // --- Logo de canto durante o vídeo -------------------------------------------------------------
  if (marca.logo) {
    const vertical = t.formato.altura > t.formato.largura;
    const pedido = marca.logoPosicao.canto;
    const canto = vertical && pedido.startsWith("inferior") ? (pedido.replace("inferior", "superior") as typeof pedido) : pedido;
    const margens = t.areaSegura ?? { topo: 0.05, base: 0.05, lados: 0.04 };
    const altura = marca.logoPosicao.alturaRelativa;
    const direita = canto.endsWith("direito");
    const sobreposicao: NonNullable<ItemImagem["sobreposicao"]> = {
      x: arredondar(direita ? 1 - margens.lados - LARGURA_MAXIMA_DO_LOGO : margens.lados),
      y: arredondar(canto.startsWith("superior") ? margens.topo : 1 - margens.base - altura),
      largura: LARGURA_MAXIMA_DO_LOGO, altura, opacidade: marca.logoPosicao.opacidade, alinhamento: direita ? "direita" : "esquerda",
    };
    const fimDoLogo = temCartao ? Math.min(fim, ...t.itens.filter((i) => i.tipo === "cartao").map((i) => i.inicioSeg)) : fim;
    const logo: ItemDaTimeline = {
      id: "logo-da-marca", tipo: "imagem", camada: 30, inicioSeg: 0, duracaoSeg: arredondar(Math.max(0.1, fimDoLogo)), arquivo: marca.logo, sobreposicao,
      enquadramento: { modo: "conter", x: 0.5, y: 0.5, zoom: 1 }, entrada: { tipo: "corte", duracaoSeg: 0 }, saida: { tipo: "corte", duracaoSeg: 0 }, efeitos: [], origem: "marca",
    };
    t.itens.push(logo);
    decidir("logo", vertical && canto !== pedido
      ? "no vídeo vertical, o logo fica no topo, dentro da área segura, longe das legendas e da interface das redes"
      : `logo no canto ${canto.replace("-", " ")}, ${Math.round(altura * 100)}% da altura, opacidade ${Math.round(marca.logoPosicao.opacidade * 100)}%`);
  }

  t.duracaoSeg = arredondar(Math.max(fimDoVideo(t), ...t.itens.filter((i) => i.origem === "marca" && i.camada === 0).map((i) => i.inicioSeg + i.duracaoSeg)));
  return { timeline: t, decisoes };
}
