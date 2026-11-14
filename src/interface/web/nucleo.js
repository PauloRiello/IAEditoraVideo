// Utilitários da interface: chamadas à aplicação, criação de elementos, avisos, diálogos e formatação.

export class ErroDaAplicacao extends Error {}

/** Chama uma operação da aplicação e devolve o resultado. Lança ErroDaAplicacao com a mensagem a mostrar. */
export async function api(caminho, { metodo = "GET", corpo } = {}) {
  let resposta;
  try {
    resposta = await fetch(caminho, {
      method: metodo, headers: corpo === undefined ? {} : { "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    throw new ErroDaAplicacao("Sem resposta da aplicação. Verifique se ela continua aberta.");
  }
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok) throw new ErroDaAplicacao(dados?.erro?.mensagem ?? `A operação falhou (código ${resposta.status}).`);
  return dados;
}

/** Envia um arquivo com acompanhamento do progresso (0 a 1). */
export function enviar(caminho, arquivo, aoProgredir) {
  return new Promise((resolver, rejeitar) => {
    const pedido = new XMLHttpRequest();
    pedido.open("POST", caminho);
    pedido.setRequestHeader("content-type", "application/octet-stream");
    pedido.upload.onprogress = (e) => { if (e.lengthComputable) aoProgredir?.(e.loaded / e.total); };
    pedido.onerror = () => rejeitar(new ErroDaAplicacao(`Não foi possível enviar ${arquivo.name}.`));
    pedido.onload = () => {
      let dados = null;
      try { dados = JSON.parse(pedido.responseText); } catch { /* resposta sem JSON */ }
      if (pedido.status >= 200 && pedido.status < 300) resolver(dados);
      else rejeitar(new ErroDaAplicacao(dados?.erro?.mensagem ?? `Não foi possível enviar ${arquivo.name}.`));
    };
    pedido.send(arquivo);
  });
}

/** Cria um elemento. Propriedades iniciadas por "ao" viram ouvintes (aoClicar → click). */
export function h(marca, propriedades = {}, ...filhos) {
  const [nome, ...classes] = marca.split(".");
  const no = document.createElement(nome || "div");
  if (classes.length) no.className = classes.join(" ");
  const eventos = { aoClicar: "click", aoMudar: "change", aoDigitar: "input", aoEnviar: "submit" };
  for (const [chave, valor] of Object.entries(propriedades ?? {})) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (eventos[chave]) no.addEventListener(eventos[chave], valor);
    else if (chave === "classe") no.className = `${no.className} ${valor}`.trim();
    else if (chave === "dados") Object.assign(no.dataset, valor);
    else if (chave in no && chave !== "list" && chave !== "form") no[chave] = valor;
    else no.setAttribute(chave, valor === true ? "" : valor);
  }
  const acrescentar = (filho) => {
    if (filho === null || filho === undefined || filho === false) return;
    if (Array.isArray(filho)) filho.forEach(acrescentar);
    else no.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
  };
  filhos.forEach(acrescentar);
  return no;
}

export const limpar = (no) => { no.replaceChildren(); return no; };

// --- Formatação -------------------------------------------------------------------------------
export const tempo = (seg) => {
  if (seg === null || seg === undefined || Number.isNaN(Number(seg))) return "—";
  const total = Math.max(0, Number(seg)), m = Math.floor(total / 60), s = total - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${Number.isInteger(s) ? s : s.toFixed(1)}`;
};
export const tamanho = (bytes) => {
  if (bytes === null || bytes === undefined) return "—";
  const unidades = ["B", "KB", "MB", "GB", "TB"];
  let valor = bytes, i = 0;
  while (valor >= 1024 && i < unidades.length - 1) { valor /= 1024; i += 1; }
  return `${valor >= 10 || i === 0 ? Math.round(valor) : valor.toFixed(1)} ${unidades[i]}`;
};
export const quando = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};
export const porcento = (fracao) => `${Math.round((fracao ?? 0) * 100)}%`;
export const nomeDoArquivo = (caminho) => String(caminho ?? "").split(/[\\/]/).pop();

// --- Componentes ---------------------------------------------------------------------------------
export function etiqueta(texto, tipo = "") {
  return h(`span.etiqueta${tipo ? `.${tipo}` : ""}`, {}, texto);
}

export function barra(fracao) {
  return h(`div.barra${fracao === null || fracao === undefined ? ".indefinida" : ""}`, {}, h("i", { style: `width:${Math.round((fracao ?? 0) * 100)}%` }));
}

export function campo(rotulo, controle, ajuda) {
  return h("label.campo", {}, h("span", {}, rotulo), controle, ajuda ? h("div.ajuda", {}, ajuda) : null);
}

export function escolha(opcoes, valor, propriedades = {}) {
  return h("select", propriedades, opcoes.map((o) => {
    const [v, rotulo] = Array.isArray(o) ? o : [o, o];
    return h("option", { value: v, selected: String(v) === String(valor ?? "") }, rotulo);
  }));
}

export function aviso(mensagem, tipo = "") {
  const no = h(`div.aviso${tipo ? `.${tipo}` : ""}`, { role: tipo === "erro" ? "alert" : "status" }, mensagem);
  document.getElementById("avisos").append(no);
  setTimeout(() => no.remove(), tipo === "erro" ? 9000 : 4500);
}

/** Executa uma ação pedida por um botão: desativa-o enquanto roda e mostra o erro, se houver. */
export async function agir(botao, acao, sucesso) {
  const alvo = botao instanceof Event ? botao.currentTarget : botao;
  if (alvo) alvo.disabled = true;
  try {
    const resultado = await acao();
    if (sucesso) aviso(sucesso, "sucesso");
    return resultado;
  } catch (erro) {
    aviso(erro instanceof ErroDaAplicacao ? erro.message : `Erro inesperado: ${erro.message}`, "erro");
    if (!(erro instanceof ErroDaAplicacao)) console.error(erro);
    return undefined;
  } finally {
    if (alvo?.isConnected) alvo.disabled = false;
  }
}

/** Abre um diálogo. `acoes` são botões do rodapé; devolve o elemento, com `fechar()`. */
export function dialogo({ titulo, corpo, acoes = [], estreito = false }) {
  const caixa = h(`dialog${estreito ? ".estreito" : ""}`, {});
  caixa.fechar = () => { caixa.close(); caixa.remove(); };
  caixa.append(
    h("header", {}, h("h2", {}, titulo), h("button.discreto", { aoClicar: caixa.fechar, "aria-label": "Fechar" }, "Fechar")),
    h("div.corpo", {}, corpo),
    acoes.length ? h("footer", {}, acoes) : null,
  );
  caixa.addEventListener("cancel", () => caixa.remove());
  document.body.append(caixa);
  caixa.showModal();
  return caixa;
}

/** Pergunta de sim ou não. Devolve uma promessa com a resposta. */
export function confirmar(titulo, mensagem, { rotulo = "Confirmar", perigo = false } = {}) {
  return new Promise((resolver) => {
    const responder = (valor) => { caixa.fechar(); resolver(valor); };
    const caixa = dialogo({
      titulo, estreito: true, corpo: h("p", {}, mensagem),
      acoes: [h("button", { aoClicar: () => responder(false) }, "Cancelar"), h(`button.${perigo ? "perigo" : "principal"}`, { aoClicar: () => responder(true) }, rotulo)],
    });
    caixa.addEventListener("cancel", () => resolver(false));
  });
}

/** Pede um texto ao usuário. Devolve o texto, ou null se cancelar. */
export function perguntar(titulo, rotulo, { valor = "", obrigatorio = true, rotuloDoBotao = "Confirmar", longo = false } = {}) {
  return new Promise((resolver) => {
    const entrada = longo ? h("textarea", { value: valor }) : h("input", { value: valor });
    const responder = (v) => { caixa.fechar(); resolver(v); };
    const enviar_ = () => { if (obrigatorio && !entrada.value.trim()) entrada.focus(); else responder(entrada.value.trim()); };
    const caixa = dialogo({
      titulo, estreito: true, corpo: campo(rotulo, entrada),
      acoes: [h("button", { aoClicar: () => responder(null) }, "Cancelar"), h("button.principal", { aoClicar: enviar_ }, rotuloDoBotao)],
    });
    caixa.addEventListener("cancel", () => resolver(null));
    entrada.focus();
  });
}

/** Converte Markdown simples (títulos, listas, tabelas, negrito, código) em elementos. */
export function markdown(texto) {
  const raiz = h("div.texto-longo");
  const emLinha = (trecho) => {
    const partes = [];
    let resto = trecho;
    const padrao = /(\*\*([^*]+)\*\*|`([^`]+)`)/;
    for (let m = padrao.exec(resto); m; m = padrao.exec(resto)) {
      if (m.index > 0) partes.push(resto.slice(0, m.index));
      partes.push(m[2] ? h("strong", {}, m[2]) : h("code", {}, m[3]));
      resto = resto.slice(m.index + m[0].length);
    }
    if (resto) partes.push(resto);
    return partes;
  };
  const linhas = String(texto ?? "").split("\n");
  for (let i = 0; i < linhas.length; i += 1) {
    const linha = linhas[i];
    const titulo = /^(#{1,4})\s+(.*)$/.exec(linha);
    if (titulo) { raiz.append(h(`h${Math.min(titulo[1].length, 3)}`, {}, emLinha(titulo[2]))); continue; }
    if (/^\s*\|.*\|\s*$/.test(linha)) {
      const bloco = [];
      while (i < linhas.length && /^\s*\|.*\|\s*$/.test(linhas[i])) { bloco.push(linhas[i]); i += 1; }
      i -= 1;
      const celulas = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const corpo = bloco.filter((l, k) => k !== 1 || !/^[\s|:-]+$/.test(l));
      raiz.append(h("div.rolavel", {}, h("table", {},
        h("thead", {}, h("tr", {}, celulas(corpo[0]).map((c) => h("th", {}, emLinha(c))))),
        h("tbody", {}, corpo.slice(1).map((l) => h("tr", {}, celulas(l).map((c) => h("td", {}, emLinha(c)))))))));
      continue;
    }
    if (/^\s*[-*]\s+/.test(linha)) {
      const itens = [];
      while (i < linhas.length && /^\s*[-*]\s+/.test(linhas[i])) { itens.push(linhas[i].replace(/^\s*[-*]\s+/, "")); i += 1; }
      i -= 1;
      raiz.append(h("ul", {}, itens.map((item) => h("li", {}, emLinha(item)))));
      continue;
    }
    if (linha.trim()) raiz.append(h("p", {}, emLinha(linha)));
  }
  return raiz;
}

/** Área para soltar arquivos ou escolhê-los, com envio um a um e progresso. */
export function areaDeEnvio({ texto, aceitos, destino, aoTerminar }) {
  const entrada = h("input", { type: "file", multiple: true, accept: aceitos.join(","), hidden: true });
  const estado = h("div");
  const area = h("div.soltar", {}, h("p", {}, texto), h("button", { type: "button", aoClicar: () => entrada.click() }, "Escolher arquivos"), entrada, estado);
  const processar = async (arquivos) => {
    const lista = [...arquivos];
    if (lista.length === 0) return;
    let enviados = 0;
    for (const [n, arquivo] of lista.entries()) {
      const progresso = barra(0);
      limpar(estado).append(h("p", { style: "margin-top:10px" }, `Enviando ${arquivo.name} (${n + 1} de ${lista.length})…`), progresso);
      try {
        await enviar(destino(arquivo), arquivo, (fracao) => { progresso.firstChild.style.width = `${Math.round(fracao * 100)}%`; });
        enviados += 1;
      } catch (erro) {
        aviso(erro.message, "erro");
      }
    }
    limpar(estado);
    entrada.value = "";
    if (enviados) aviso(`${enviados} arquivo(s) adicionado(s).`, "sucesso");
    await aoTerminar?.(enviados);
  };
  entrada.addEventListener("change", () => processar(entrada.files));
  area.addEventListener("dragover", (e) => { e.preventDefault(); area.classList.add("sobre"); });
  area.addEventListener("dragleave", () => area.classList.remove("sobre"));
  area.addEventListener("drop", (e) => { e.preventDefault(); area.classList.remove("sobre"); processar(e.dataTransfer.files); });
  return area;
}

export function linhaDeTarefa(t) {
  const estados = { "na-fila": ["Na fila", "info"], executando: ["Em andamento", "destaque"], concluida: ["Concluída", "bom"], falhou: ["Falhou", "ruim"], cancelada: ["Cancelada", "alerta"] };
  const [rotulo, tipo] = estados[t.estado] ?? [t.estado, ""];
  const ativa = t.estado === "na-fila" || t.estado === "executando";
  return h("li", { style: "display:block" },
    h("div.linha", {}, h("strong", {}, t.titulo), h("span.espaco"), etiqueta(rotulo, tipo)),
    ativa ? h("div", { style: "margin-top:6px" }, h("small", {}, t.etapa || "Aguardando"), barra(t.estado === "executando" ? t.progresso : 0)) : null,
    t.erro ? h("small", { style: "color:var(--ruim)" }, t.erro) : null,
  );
}
