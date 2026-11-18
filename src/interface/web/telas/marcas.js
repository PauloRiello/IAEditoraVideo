// Marcas: identidade visual (logo, cores, fontes) aplicada nos vídeos. A página só mostra o que a
// aplicação encontrou no manual, com a origem de cada item, e pede a confirmação do usuário.

import { agir, api, areaDeEnvio, atualizarBarra, aviso, barra, campo, confirmar, dialogo, escolha, etiqueta, h, limpar, por, quando } from "/nucleo.js";

const PAPEIS = [["", "Sem papel"], ["primaria", "Primária"], ["secundaria", "Secundária"], ["destaque", "Destaque"], ["texto", "Texto"], ["fundo", "Fundo"]];
const CANTOS = [["superior-direito", "Superior direito"], ["superior-esquerdo", "Superior esquerdo"], ["inferior-direito", "Inferior direito"], ["inferior-esquerdo", "Inferior esquerdo"]];
const IMAGENS = [".png", ".svg", ".gif", ".jpg", ".jpeg", ".webp"];
const FONTES = [".ttf", ".otf", ".woff", ".woff2"];
const imagem = (id, qual, versao) => h("img.logo-da-marca", { src: `/api/marcas/${id}/imagem/${qual}?v=${encodeURIComponent(versao)}`, alt: "" });
const amostra = (hex) => h("span.amostra-de-cor", { style: `background:${hex}`, title: hex });

export async function mostrar(raiz, contexto, partes = []) {
  if (partes[0]) return mostrarMarca(raiz, contexto, partes[0]);
  const lista = h("div");
  const carregar = async () => {
    const marcas = await api("/api/marcas");
    por(limpar(lista), marcas.length === 0 ? h("div.vazio", {}, "Nenhuma marca ainda. Crie uma e envie o manual da marca em PDF.") : h("table", {},
      h("thead", {}, h("tr", {}, ["", "Marca", "Cores", "Situação", "Atualizada", ""].map((c) => h("th", {}, c)))),
      h("tbody", {}, marcas.map((m) => h("tr", {},
        h("td", { style: "width:72px" }, m.logo ? imagem(m.id, "logo", m.atualizadaEm) : h("span.suave", {}, "sem logo")),
        h("td", {}, h("strong", {}, m.nome)),
        h("td", {}, m.cores.map((c) => amostra(c.hex))),
        h("td", {}, m.estado === "pronta" ? etiqueta("Pronta", "bom") : etiqueta("Rascunho", "alerta")),
        h("td", {}, quando(m.atualizadaEm)),
        h("td", { style: "text-align:right" }, h("button.pequeno", { aoClicar: () => contexto.ir(`#/marcas/${m.id}`) }, "Abrir")))))));
  };
  const nova = () => {
    const nome = h("input", { placeholder: "Nome da marca" });
    const caixa = dialogo({
      titulo: "Nova marca", estreito: true, corpo: campo("Nome", nome),
      acoes: [h("button", { aoClicar: () => caixa.fechar() }, "Cancelar"), h("button.principal", { aoClicar: (e) => agir(e, async () => {
        const marca = await api("/api/marcas", { metodo: "POST", corpo: { nome: nome.value } });
        caixa.fechar();
        contexto.ir(`#/marcas/${marca.id}`);
      }) }, "Criar")],
    });
    nome.focus();
  };
  por(raiz,
    h("div.cabecalho", {}, h("div", {}, h("h1", {}, "Marcas"), h("div.subtitulo", {}, "Logo, cores e fontes de cada marca, aplicados nos vídeos dos projetos que a escolherem.")),
      h("div.acoes", {}, h("button.principal", { aoClicar: nova }, "Nova marca"))),
    h("section.bloco", {}, lista));
  await carregar();
  return {};
}

async function mostrarMarca(raiz, contexto, id) {
  let m = await api(`/api/marcas/${id}`);
  let cores = m.cores.map((c) => ({ ...c }));
  const area = h("div");
  const selo = h("div.acoes");
  const andamento = h("div");
  const barras = new Map();
  const recarregar = async () => { m = await api(`/api/marcas/${id}`); cores = m.cores.map((c) => ({ ...c })); desenhar(); };
  const origem = (texto, base) => h("small.origem", {}, `${texto}${base === "estimado" ? " · estimado" : ""}`);

  // --- Manual -------------------------------------------------------------------------------
  const manual = () => h("section.bloco", {}, h("h2", {}, "Manual da marca (PDF)"),
    h("p.suave", {}, "O programa lê o manual e sugere logo, cores e fontes, mostrando de onde veio cada item. Nada é aplicado sem você confirmar abaixo."),
    areaDeEnvio({ texto: "Arraste o manual em PDF para cá.", aceitos: [".pdf"], destino: (arquivo) => `/api/marcas/${id}/manual?nome=${encodeURIComponent(arquivo.name)}` }),
    andamento,
    m.sugestoes?.avisos.length ? h("div", { style: "margin-top:10px" }, m.sugestoes.avisos.map((a) => h("div.nota.alerta", {}, a))) : null,
    m.materiais.length ? h("p.suave", { style: "margin-top:10px" }, `Materiais guardados: ${m.materiais.map((x) => x.nome).join(", ")}`) : null);

  // --- Logo ---------------------------------------------------------------------------------
  const logo = () => {
    const sugestoes = m.sugestoes?.logos ?? [];
    return h("section.bloco", {}, h("h2", {}, "Logo"),
      h("div.linha", { style: "align-items:flex-start;gap:20px" },
        h("div", {}, h("div.suave", {}, "Em uso"), m.logo ? imagem(id, "logo", m.atualizadaEm) : h("div.vazio", {}, "Nenhum logo escolhido.")),
        sugestoes.length ? h("div", { style: "flex:1" }, h("div.suave", {}, "Encontrados no manual (escolha um)"),
          h("div.grade-de-logos", {}, sugestoes.map((s, i) => h("div.candidata", {},
            imagem(id, `sugestao-${i}`, m.atualizadaEm), origem(`página ${s.pagina}`, s.base),
            h("button.pequeno", { aoClicar: (e) => agir(e, async () => { m = await api(`/api/marcas/${id}/logo-sugerido`, { metodo: "POST", corpo: { indice: i } }); desenhar(); }, "Logo escolhido.") }, "Usar este"))))) : null),
      h("div", { style: "margin-top:12px" }, areaDeEnvio({ texto: "Ou envie o arquivo do logo (PNG, SVG ou GIF).", aceitos: IMAGENS, destino: (arquivo) => `/api/marcas/${id}/arquivo?papel=logo&nome=${encodeURIComponent(arquivo.name)}`, aoTerminar: recarregar })),
      h("details", { style: "margin-top:10px" }, h("summary", {}, "Versão clara do logo, para fundos escuros (opcional)"),
        areaDeEnvio({ texto: "Envie a versão clara.", aceitos: IMAGENS, destino: (arquivo) => `/api/marcas/${id}/arquivo?papel=logoClaro&nome=${encodeURIComponent(arquivo.name)}`, aoTerminar: recarregar })));
  };

  // --- Cores --------------------------------------------------------------------------------
  const linhasDeCores = h("div");
  const desenharCores = () => por(limpar(linhasDeCores), cores.length === 0 ? h("div.vazio", {}, "Nenhuma cor confirmada.") : cores.map((c, i) => {
    const seletor = h("input", { type: "color", value: c.hex, aoDigitar: () => { c.hex = seletor.value.toUpperCase(); c.base = "observado"; c.fonte = "escolhida pelo usuário"; codigo.value = c.hex; } });
    const codigo = h("input", { value: c.hex, style: "width:100px", aoMudar: () => { c.hex = codigo.value.trim(); seletor.value = /^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : seletor.value; c.base = "observado"; c.fonte = "escolhida pelo usuário"; } });
    const papel = escolha(PAPEIS, c.papel ?? "", { aoMudar: () => { c.papel = papel.value || null; } });
    return h("div.linha.linha-de-cor", {}, seletor, codigo, papel, origem(c.fonte, c.base), h("span.espaco"),
      h("button.pequeno.perigo", { aoClicar: () => { cores.splice(i, 1); desenharCores(); } }, "Tirar"));
  }));
  const coresSec = () => {
    desenharCores();
    const sugeridas = (m.sugestoes?.cores ?? []).filter((s) => !cores.some((c) => c.hex === s.hex));
    return h("section.bloco", {}, h("h2", {}, "Cores"),
      linhasDeCores,
      sugeridas.length ? h("div", { style: "margin-top:10px" }, h("div.suave", {}, "Sugeridas pelo manual"), h("div.linha", { style: "gap:8px;flex-wrap:wrap" }, sugeridas.map((s) =>
        h("button.pequeno", { title: s.fonte, aoClicar: () => { cores.push({ ...s }); desenhar(); } }, amostra(s.hex), ` ${s.hex}${s.papel ? ` (${PAPEIS.find((p) => p[0] === s.papel)?.[1]})` : ""}`)))) : null,
      h("div.linha", { style: "margin-top:12px;gap:8px" },
        h("button", { aoClicar: () => { cores.push({ hex: "#000000", papel: null, base: "observado", fonte: "escolhida pelo usuário" }); desenharCores(); } }, "Adicionar cor"),
        m.logo ? h("button", { aoClicar: (e) => agir(e, async () => { const medidas = await api(`/api/marcas/${id}/cores-do-logo`, { metodo: "POST" }); for (const c of medidas) if (!cores.some((x) => x.hex === c.hex)) cores.push(c); desenharCores(); }) }, "Sugerir cores do logo") : null,
        h("span.espaco"),
        h("button.principal", { aoClicar: (e) => agir(e, async () => { m = await api(`/api/marcas/${id}`, { metodo: "PUT", corpo: { cores } }); cores = m.cores.map((c) => ({ ...c })); desenhar(); }, "Cores salvas.") }, "Salvar cores")));
  };

  // --- Fontes -------------------------------------------------------------------------------
  const fonteSec = (papel, rotulo) => {
    const atual = m.fontes[papel];
    const sugerida = (m.sugestoes?.fontes ?? []).find((f) => f.papel === papel) ?? (m.sugestoes?.fontes ?? [])[papel === "titulos" ? 0 : 1];
    const nome = h("input", { value: atual?.nome ?? sugerida?.nome ?? "", placeholder: "Nome da fonte (por exemplo Montserrat)" });
    const situacao = !atual ? etiqueta("Não definida") : atual.origem === "pendente" ? etiqueta("Pendente: o vídeo usa a fonte padrão", "alerta") : etiqueta(atual.origem === "google-fonts" ? "Do Google Fonts" : "Enviada", "bom");
    return h("div.fonte-da-marca", {}, h("h3", {}, rotulo, " ", situacao),
      sugerida ? h("small.origem", {}, `Encontrada no manual, página ${sugerida.pagina}`) : null,
      h("div.linha", { style: "gap:8px;margin-top:6px" }, h("div", { style: "flex:1" }, nome),
        h("button", { aoClicar: async (e) => {
          if (!nome.value.trim()) return aviso("Escreva o nome da fonte.", "erro");
          if (!(await confirmar(`Baixar ${nome.value.trim()} do Google Fonts?`, "Se a fonte estiver no Google Fonts (gratuita, com licença que permite uso comercial), ela é baixada para a pasta da marca. Precisa de internet.", { rotulo: "Baixar" }))) return;
          await agir(e.target, async () => { await api(`/api/marcas/${id}/fontes/google`, { metodo: "POST", corpo: { papel, nome: nome.value } }); aviso("Procurando no Google Fonts…"); });
        } }, "Procurar no Google Fonts"),
        h("button", { title: "Salva o nome; o vídeo usa a fonte padrão até o arquivo chegar", aoClicar: (e) => agir(e, async () => { m = await api(`/api/marcas/${id}/fontes/pendente`, { metodo: "POST", corpo: { papel, nome: nome.value } }); desenhar(); }, "Fonte marcada como pendente.") }, "Deixar pendente")),
      h("div", { style: "margin-top:8px" }, areaDeEnvio({ texto: "Ou envie o arquivo da fonte (TTF, OTF, WOFF).", aceitos: FONTES, destino: (arquivo) => `/api/marcas/${id}/arquivo?papel=fonte-${papel}&nome=${encodeURIComponent(arquivo.name)}`, aoTerminar: recarregar })));
  };

  // --- Posição do logo e conclusão ---------------------------------------------------------
  const posicao = () => {
    const canto = escolha(CANTOS, m.logoPosicao.canto);
    const altura = h("input", { type: "number", min: 3, max: 30, value: Math.round(m.logoPosicao.alturaRelativa * 100) });
    const opacidade = h("input", { type: "number", min: 20, max: 100, value: Math.round(m.logoPosicao.opacidade * 100) });
    return h("section.bloco", {}, h("h2", {}, "Logo durante o vídeo"),
      h("div.formulario", {}, campo("Canto", canto), campo("Altura (% da tela)", altura), campo("Opacidade (%)", opacidade, "No fim do vídeo o logo aparece grande, no cartão final ou num encerramento curto.")),
      h("button", { style: "margin-top:10px", aoClicar: (e) => agir(e, async () => { m = await api(`/api/marcas/${id}`, { metodo: "PUT", corpo: { logoPosicao: { canto: canto.value, alturaRelativa: Number(altura.value) / 100, opacidade: Number(opacidade.value) / 100 } } }); }, "Posição salva.") }, "Salvar posição"));
  };

  function desenhar() {
    por(limpar(selo), m.estado === "pronta" ? etiqueta("Pronta", "bom") : etiqueta("Rascunho", "alerta"));
    por(limpar(area),
      manual(), logo(), coresSec(),
      h("section.bloco", {}, h("h2", {}, "Fontes"), fonteSec("titulos", "Títulos e cartões"), fonteSec("texto", "Legendas e textos")),
      posicao(),
      h("section.bloco", {}, h("div.linha", {},
        m.estado === "pronta" ? h("span", {}, etiqueta("Pronta", "bom"), " Os projetos já podem escolher esta marca.") : h("span.suave", {}, "Confirme o logo e ao menos uma cor para a marca ficar pronta."),
        h("span.espaco"),
        h("button.perigo", { aoClicar: async (e) => {
          if (await confirmar("Remover esta marca?", `"${m.nome}" e os arquivos copiados para ela serão apagados. Os arquivos originais que você enviou não são tocados.`, { rotulo: "Remover", perigo: true })) {
            await agir(e.target, async () => { await api(`/api/marcas/${id}`, { metodo: "DELETE" }); contexto.ir("#/marcas"); }, "Marca removida.");
          }
        } }, "Remover marca"), " ",
        m.estado === "pronta" ? null : h("button.principal", { aoClicar: (e) => agir(e, async () => {
          m = await api(`/api/marcas/${id}/pronta`, { metodo: "POST" });
          contexto.catalogo = await api("/api/catalogo");
          desenhar();
        }, "Marca pronta para os projetos.") }, "Marca pronta"))));
  }

  por(raiz,
    h("div.cabecalho", {}, h("div", {}, h("a", { href: "#/marcas", style: "font-size:13px" }, "← Marcas"), h("h1", {}, m.nome), h("div.subtitulo", {}, "Confirme o que o programa encontrou. Cada item mostra de onde veio.")),
      selo),
    area);
  desenhar();
  return {
    aoEvento: (nome, dados) => {
      if (nome !== "tarefa:atualizada" || (dados.tipo !== "leitura-de-manual" && dados.tipo !== "fonte-da-marca") || !dados.titulo.includes(m.nome)) return;
      const ativa = dados.estado === "na-fila" || dados.estado === "executando";
      if (ativa) {
        if (!barras.has(dados.id)) { const linha = h("div", { style: "margin-top:10px" }, h("small", {}, dados.titulo), barra(0), h("small.etapa-da-tarefa")); barras.set(dados.id, linha); andamento.append(linha); }
        const linha = barras.get(dados.id);
        atualizarBarra(linha, dados.progresso ?? 0);
        linha.querySelector(".etapa-da-tarefa").textContent = dados.etapa || "Na fila";
        return;
      }
      barras.get(dados.id)?.remove();
      barras.delete(dados.id);
      if (dados.estado === "falhou") aviso(dados.erro ?? "A tarefa falhou.", "erro");
      else recarregar().catch(() => undefined);
    },
  };
}
