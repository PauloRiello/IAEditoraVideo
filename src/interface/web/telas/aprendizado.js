// Aprendizado: o que a aplicação aprendeu, perfis de estilo, preferências do usuário, histórico e controle da memória.

import { agir, api, campo, confirmar, dialogo, escolha, etiqueta, h, limpar, perguntar, porcento, quando } from "/nucleo.js";

const ESTADOS = { ativo: ["Em vigor", "bom"], candidato: ["Candidato", "alerta"], desativado: ["Desativado", ""] };
const ORIGENS = { feedback: "avaliação", analise: "análise", correcao: "correção sua", usuario: "instrução sua" };
const ACOES = { corrigido: "Corrigido", desativado: "Desativado", ativado: "Ativado", excluido: "Excluído" };
const valorEmTexto = (valor) => (valor === null || valor === undefined ? "" : typeof valor === "object" ? JSON.stringify(valor) : String(valor));

export async function mostrar(raiz, contexto) {
  const { catalogo } = contexto;
  const area = h("div");
  let dados = null, secao = "aprendido";

  const mudar = (caminho, metodo, sucesso, corpo) => (evento) => agir(evento, async () => { await api(caminho, { metodo, corpo }); await carregar(); }, sucesso);

  const verEvidencias = (a) => (evento) => agir(evento, async () => {
    const d = await api(`/api/aprendizados/${a.id}`);
    dialogo({ titulo: "De onde veio este aprendizado", corpo: h("div", {},
      h("p", {}, h("strong", {}, a.descricao)), h("p.suave", {}, `Confiança de ${porcento(a.confianca)}: ${a.evidencias} evidência(s) a favor e ${a.contrarias} contra, de ${a.projetosObservados} fonte(s) distinta(s).`),
      h("ul.lista", {}, d.evidencias.map((e) => h("li", {}, h("time", {}, quando(e.criadoEm)), h("span", {}, etiqueta(e.confirma ? "Confirma" : "Contradiz", e.confirma ? "bom" : "ruim"), " ",
        ORIGENS[e.origem] ?? e.origem, e.projetoId ? ` · projeto ${dados.projetos[e.projetoId] ?? "removido"}` : "", e.referenciaId ? " · referência" : "", e.resultadoId ? " · resultado publicado (sinal fraco)" : "", e.detalhe ? ` — ${e.detalhe}` : ""))))) });
  });

  const corrigir = (a) => async (evento) => {
    const descricao = await perguntar("Corrigir aprendizado", "Como este aprendizado deveria ser descrito?", { valor: a.descricao, longo: true, rotuloDoBotao: "Salvar correção" });
    if (descricao !== null) await mudar(`/api/aprendizados/${a.id}`, "PUT", "Aprendizado corrigido.", { descricao })(evento.target);
  };
  const excluir = (a) => async (evento) => {
    if (await confirmar("Excluir este aprendizado?", "Ele deixa de valer. A exclusão fica no histórico e pode ser desfeita.", { rotulo: "Excluir", perigo: true })) await mudar(`/api/aprendizados/${a.id}`, "DELETE", "Aprendizado excluído.")(evento.target);
  };

  const cartao = (a) => h("li", { style: "display:block" },
    h("div.linha", {}, etiqueta(...(ESTADOS[a.estado] ?? [a.estado, ""])), etiqueta(a.categoria), h("strong", { style: "flex:1;min-width:200px" }, a.descricao),
      h("small", { title: "Confiança" }, porcento(a.confianca))),
    h("div.linha", { style: "margin-top:4px" },
      h("small", {}, `${a.evidencias} a favor, ${a.contrarias} contra · ${a.projetosObservados} fonte(s)${valorEmTexto(a.valor) ? ` · valor: ${valorEmTexto(a.valor)}` : ""}${a.expiraEm ? ` · vale até ${quando(a.expiraEm)}` : ""}`), h("span.espaco"),
      h("button.pequeno", { aoClicar: verEvidencias(a) }, "Evidências"), h("button.pequeno", { aoClicar: corrigir(a) }, "Corrigir"),
      a.estado === "ativo" ? h("button.pequeno", { aoClicar: mudar(`/api/aprendizados/${a.id}/desativar`, "POST", "Aprendizado desativado.") }, "Desativar")
        : h("button.pequeno", { title: "Passa a valer por decisão sua", aoClicar: mudar(`/api/aprendizados/${a.id}/ativar`, "POST", "Aprendizado ativado.") }, "Ativar"),
      h("button.pequeno.perigo", { aoClicar: excluir(a) }, "Excluir")));
  const grupo = (titulo, itens, ajuda) => h("section.bloco", {}, h("h2", {}, titulo), ajuda ? h("p.suave", {}, ajuda) : null, itens.length ? h("ul.lista", {}, itens.map(cartao)) : h("div.vazio", {}, "Nada aprendido neste contexto."));

  function aprendido() {
    const p = dados.painel;
    const total = p.geral.length + p.temporarias.length + Object.values(p.perfis).flat().length + Object.values(p.projetos).flat().length;
    return [
      total === 0 ? h("div.nota", {}, "A aplicação ainda não aprendeu nada. Ela aprende com a análise de referências, com as suas avaliações e correções e com as preferências que você registrar.") : null,
      grupo("Geral — vale para todos os projetos", p.geral, "Só entra aqui o que foi confirmado em pelo menos três fontes diferentes, ou o que você mesmo determinou."),
      Object.entries(p.perfis).map(([perfil, itens]) => grupo(`Segmento: ${catalogo.perfis.find((x) => x.id === perfil)?.nome ?? perfil}`, itens)),
      Object.entries(p.projetos).map(([projeto, itens]) => grupo(`Projeto: ${dados.projetos[projeto] ?? "removido"}`, itens)),
      p.temporarias.length ? grupo("Orientações temporárias", p.temporarias) : null,
    ];
  }

  function estilos() {
    const comEstilo = dados.perfis.filter((p) => Object.keys(p.aprendido).length);
    return comEstilo.length === 0 ? h("div.vazio", {}, "Nenhum segmento tem preferências em vigor ainda. O perfil de estilo de um segmento é formado pelo que foi aprendido e confirmado nele.") : comEstilo.map((p) => h("section.bloco", {}, h("h2", {}, p.nome),
      h("table", {}, h("thead", {}, h("tr", {}, ["Assunto", "Preferência em vigor", "Confiança", "Evidências", "Fontes"].map((c) => h("th", {}, c)))),
        h("tbody", {}, Object.entries(p.aprendido).map(([assunto, x]) => h("tr", {}, h("td", {}, assunto), h("td", {}, valorEmTexto(x.valor) || "—"), h("td", {}, porcento(x.confianca)), h("td", {}, x.evidencias), h("td", {}, x.fontes)))))));
  }

  function preferencias() {
    const escopo = escolha([["geral", "Todos os projetos"], ["especializacao", "Um segmento"], ["projeto", "Um projeto"]], "geral");
    const perfil = escolha(catalogo.perfis.map((p) => [p.id, p.nome]), catalogo.perfilPadrao);
    const projeto = escolha(Object.entries(dados.projetos), "");
    const categoria = escolha(catalogo.categorias, "ritmo");
    const descricao = h("textarea", { placeholder: "Por exemplo: nunca usar barras de cinema em vídeos verticais." });
    const campoPerfil = campo("Segmento", perfil), campoProjeto = campo("Projeto", projeto);
    const atualizar = () => { campoPerfil.hidden = escopo.value !== "especializacao"; campoProjeto.hidden = escopo.value !== "projeto"; };
    escopo.addEventListener("change", atualizar);
    atualizar();
    const salvar = (evento) => agir(evento, async () => {
      await api("/api/aprendizado/preferencias", { metodo: "POST", corpo: { escopo: escopo.value, perfil: perfil.value, projetoId: projeto.value, categoria: categoria.value, descricao: descricao.value } });
      secao = "aprendido";
      await carregar();
    }, "Preferência registrada. Ela já vale no contexto escolhido.");
    return h("section.bloco", {}, h("h2", {}, "Registrar uma preferência"),
      h("p.suave", {}, "O que você determina aqui vale de imediato, sem depender de evidências, e pode ser corrigido, desativado ou excluído depois."),
      h("div.formulario", {}, campo("Vale para", escopo), campoPerfil, campoProjeto, campo("Assunto", categoria), h("div.larga", {}, campo("Preferência", descricao))),
      h("button.principal", { style: "margin-top:14px", aoClicar: salvar }, "Registrar preferência"));
  }

  function historico() {
    return h("section.bloco", {}, h("h2", {}, "Histórico de ações sobre aprendizados"),
      h("p.suave", {}, "Toda correção, desativação, ativação ou exclusão guarda o estado anterior e pode ser desfeita."),
      dados.acoes.length === 0 ? h("div.vazio", {}, "Nenhuma ação registrada.") : h("ul.lista", {}, dados.acoes.map((a) => h("li", {}, h("time", {}, quando(a.criadoEm)),
        h("span", { style: "flex:1" }, h("strong", {}, ACOES[a.acao] ?? a.acao), `: ${a.descricao}`),
        a.desfeita ? etiqueta("Desfeita") : h("button.pequeno", { aoClicar: mudar(`/api/aprendizado/acoes/${a.id}/desfazer`, "POST", "Ação desfeita.") }, "Desfazer")))));
  }

  function desenhar() {
    const secoes = [["aprendido", "O que foi aprendido"], ["estilos", "Perfis de estilo"], ["preferencias", "Preferências"], ["historico", "Histórico e controle"]];
    limpar(area).append(
      h("nav.abas", { style: "margin-top:0" }, secoes.map(([id, nome]) => h(`a${id === secao ? ".ativo" : ""}`, { href: "#/aprendizado", aoClicar: (e) => { e.preventDefault(); secao = id; desenhar(); } }, nome))),
      secao === "aprendido" ? aprendido() : secao === "estilos" ? estilos() : secao === "preferencias" ? preferencias() : historico());
  }
  const carregar = async () => { dados = await api("/api/aprendizado"); desenhar(); };

  raiz.append(h("div.cabecalho", {}, h("div", {}, h("h1", {}, "Aprendizado"),
    h("div.subtitulo", {}, "A memória da aplicação fica neste computador. Aqui você vê o que ela aprendeu, de onde veio, e controla o que vale."))), area);
  await carregar();
}
