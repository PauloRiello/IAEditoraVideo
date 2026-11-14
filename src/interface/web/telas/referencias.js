// Referências: vídeos prontos cujo estilo a aplicação observa. Envio, análise, relatórios e remoção.

import { agir, api, areaDeEnvio, aviso, confirmar, escolha, etiqueta, h, limpar, quando } from "/nucleo.js";
import { verRelatorioDaReferencia } from "/telas/projeto-material.js";

export async function mostrar(raiz, contexto) {
  const { catalogo } = contexto;
  const tabela = h("div");
  const perfil = escolha([["", "Sem segmento definido"], ...catalogo.perfis.map((p) => [p.id, p.nome])], "");
  const transcrever = h("input", { type: "checkbox", checked: true });
  const nomeDoPerfil = (id) => catalogo.perfis.find((p) => p.id === id)?.nome ?? "—";

  const analisar = (ids) => (evento) => agir(evento, async () => {
    await api("/api/referencias/analisar", { metodo: "POST", corpo: { ids, transcrever: transcrever.checked } });
    aviso("Análise iniciada. Você pode continuar usando a aplicação.");
  });
  const remover = (r) => async (evento) => {
    if (await confirmar("Remover esta referência?", `"${r.titulo}" sai da aplicação junto com o que ela havia ensinado. O arquivo de vídeo continua na pasta.`, { rotulo: "Remover", perigo: true })) {
      await agir(evento.target, async () => { await api(`/api/referencias/${r.id}`, { metodo: "DELETE" }); await carregar(); }, "Referência removida.");
    }
  };

  const desenhar = (lista) => {
    const pendentes = lista.filter((r) => !r.analisada && r.existe);
    limpar(tabela).append(
      h("div.linha", { style: "margin-bottom:12px" },
        h("label.marca-campo", { title: "Usa o Whisper neste computador." }, transcrever, "Transcrever as falas"), h("span.espaco"),
        pendentes.length ? h("button.principal", { aoClicar: analisar(pendentes.map((r) => r.id)) }, `Analisar ${pendentes.length} não analisada(s)`) : null),
      lista.length === 0 ? h("div.vazio", {}, "Nenhuma referência cadastrada.") : h("div.rolavel", {}, h("table", {},
        h("thead", {}, h("tr", {}, ["Referência", "Segmento", "Situação", "Adicionada em", ""].map((c) => h("th", {}, c)))),
        h("tbody", {}, lista.map((r) => h("tr", {},
          h("td", {}, h("strong", {}, r.titulo)), h("td", {}, r.perfil ? nomeDoPerfil(r.perfil) : "—"),
          h("td", {}, !r.existe ? etiqueta("Arquivo ausente", "ruim") : r.analisada ? etiqueta("Analisada", "bom") : etiqueta("Não analisada")), h("td", {}, quando(r.criadoEm)),
          h("td", { style: "text-align:right;white-space:nowrap" },
            r.analisada ? h("button.pequeno", { aoClicar: (e) => agir(e, () => verRelatorioDaReferencia(r.id)) }, "Ver relatório") : null, " ",
            r.existe ? h("button.pequeno", { aoClicar: analisar([r.id]) }, r.analisada ? "Analisar de novo" : "Analisar") : null, " ",
            h("button.pequeno.perigo", { aoClicar: remover(r) }, "Remover"))))))));
  };
  const carregar = async () => desenhar(await api("/api/referencias"));

  raiz.append(
    h("div.cabecalho", {},
      h("div", {}, h("h1", {}, "Referências"), h("div.subtitulo", {}, "Vídeos prontos que mostram o estilo desejado. A aplicação aprende princípios com eles, sem copiar.")),
      h("div.acoes", {},
        h("button", { aoClicar: (e) => agir(e, () => api("/api/abrir", { metodo: "POST", corpo: { alvo: "referencias" } })) }, "Abrir pasta"),
        h("button", { title: "Registra os vídeos copiados direto para a pasta de referências", aoClicar: (e) => agir(e, async () => {
          const r = await api("/api/referencias/importar", { metodo: "POST" });
          desenhar(r.referencias);
          aviso(r.novas ? `${r.novas} referência(s) nova(s) encontrada(s).` : "Nenhum vídeo novo na pasta.");
        }) }, "Procurar novos arquivos"))),
    h("section.bloco", {}, h("h2", {}, "Adicionar referências"),
      h("div", { style: "max-width:340px;margin-bottom:12px" }, h("label.campo", {}, h("span", {}, "Segmento das referências enviadas"), perfil)),
      areaDeEnvio({
        texto: "Arraste os vídeos de referência para cá. Use apenas material que você tem autorização para analisar.", aceitos: catalogo.extensoesDeVideo,
        destino: (arquivo) => `/api/referencias/arquivo?nome=${encodeURIComponent(arquivo.name)}${perfil.value ? `&perfil=${perfil.value}` : ""}`, aoTerminar: carregar,
      })),
    h("section.bloco", {}, h("h2", {}, "Referências cadastradas"), tabela),
  );
  await carregar();
  return {
    aoEvento: (nome, dados) => {
      if (nome === "tarefa:atualizada" && dados.tipo === "analise-de-referencias" && dados.estado !== "na-fila" && dados.estado !== "executando") carregar().catch(() => undefined);
    },
  };
}
