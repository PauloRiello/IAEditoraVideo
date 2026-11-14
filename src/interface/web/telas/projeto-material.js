// Aba "Material e análise": vídeos brutos (envio, análise, cenas, transcrição, pesquisa) e referências do projeto.

import { agir, api, areaDeEnvio, aviso, dialogo, escolha, etiqueta, h, limpar, markdown, quando, tamanho, tempo } from "/nucleo.js";

const INTEGRIDADE = { integro: ["Íntegro", "bom"], "com-erros": ["Com erros", "alerta"], ilegivel: ["Ilegível", "ruim"] };

export async function verRelatorioDaReferencia(id) {
  const r = await api(`/api/referencias/${id}/relatorio`);
  dialogo({ titulo: `Relatório da referência: ${r.referencia.titulo}`, corpo: r.markdown ? markdown(r.markdown) : h("div.vazio", {}, "Esta referência ainda não foi analisada.") });
}

async function verBruto(projetoId, midiaId) {
  const d = await api(`/api/projetos/${projetoId}/brutos/${midiaId}`);
  const t = d.arquivo?.tecnico, c = d.conteudo;
  const problemas = [...(d.arquivo?.problemas ?? []), ...(c?.possiveisErros ?? [])];
  const corpo = h("div", {},
    h("div.visor", { style: "margin-bottom:14px" }, h("video", { src: `/api/projetos/${projetoId}/brutos/${midiaId}/arquivo`, controls: true, preload: "metadata" })),
    !d.arquivo ? h("div.vazio", {}, "Este vídeo ainda não foi analisado.") : [
      h("h3", {}, "Dados técnicos"),
      t ? h("dl.chaves", {},
        h("dt", {}, "Duração"), h("dd", {}, tempo(t.duracaoSeg)), h("dt", {}, "Imagem"), h("dd", {}, `${t.largura}×${t.altura} (${t.orientacao}), ${t.fps} quadros/s, ${t.codecVideo}`),
        h("dt", {}, "Áudio"), h("dd", {}, t.temAudio ? `${t.codecAudio ?? "presente"}` : "Sem áudio"), h("dt", {}, "Tamanho"), h("dd", {}, tamanho(d.arquivo.tamanhoBytes)),
        h("dt", {}, "Integridade"), h("dd", {}, `${INTEGRIDADE[d.arquivo.integridade]?.[0] ?? d.arquivo.integridade} — ${d.arquivo.verificacao}`))
        : h("div.nota.erro", {}, "O arquivo não pôde ser lido."),
      problemas.length ? [h("h3", { style: "margin-top:16px" }, "Problemas encontrados"), h("ul.lista", {}, problemas.map((p) => h("li", {}, etiqueta(p.gravidade === "erro" ? "Erro" : "Aviso", p.gravidade === "erro" ? "ruim" : "alerta"),
        h("span", {}, `${p.descricao}${p.inicioSeg !== undefined ? ` (${tempo(p.inicioSeg)}–${tempo(p.fimSeg)})` : ""}`))))] : null,
    ],
    c ? [
      h("h3", { style: "margin-top:16px" }, `Cenas identificadas (${c.cenas.length})`),
      h("div.cenas", {}, c.cenas.map((cena) => h("div.cena", {},
        cena.miniatura ? h("img", { src: cena.miniatura, loading: "lazy", alt: "" }) : h("div.sem-imagem"),
        h("div", {}, h("strong", {}, `${tempo(cena.inicioSeg)}–${tempo(cena.fimSeg)}`), c.destaques.includes(cena.indice) ? [" ", etiqueta("Destaque", "destaque")] : null,
          h("div.suave", {}, `Ação ${Math.round(cena.acao * 100)}%${cena.movimento ? ` · ${cena.movimento}` : ""}`), cena.fala ? h("div", {}, `“${cena.fala}”`) : null)))),
      h("h3", { style: "margin-top:16px" }, "Transcrição"),
      c.transcricao?.segmentos.length
        ? h("ul.lista", {}, c.transcricao.segmentos.map((s) => h("li", {}, h("time", {}, `${tempo(s.inicioSeg)}–${tempo(s.fimSeg)}`), h("span", {}, s.texto))))
        : h("div.suave", {}, "Sem fala transcrita neste vídeo."),
      c.limitacoes.length ? [h("h3", { style: "margin-top:16px" }, "O que não foi avaliado"), h("ul", {}, c.limitacoes.map((l) => h("li.suave", {}, l)))] : null,
    ] : null,
  );
  dialogo({ titulo: d.nome, corpo });
}

export async function aba(raiz, estado) {
  const { contexto } = estado;
  const id = estado.projeto.id;
  const tabela = h("div"), referencias = h("div"), resultados = h("div"), botoes = h("div.linha");
  const transcrever = h("input", { type: "checkbox", checked: true });
  let analisando = false;

  const analisar = (refazer) => (evento) => agir(evento, async () => {
    await api(`/api/projetos/${id}/brutos/analisar`, { metodo: "POST", corpo: { transcrever: transcrever.checked, refazer } });
    analisando = true;
    desenharBotoes([]);
    aviso("Análise iniciada. Você pode continuar usando a aplicação.");
  });

  let ultimos = [];
  const desenharBotoes = (brutos) => {
    if (brutos.length) ultimos = brutos;
    const pendentes = ultimos.filter((b) => !b.analisado).length;
    limpar(botoes).append(
      h("label.marca-campo", { title: "Usa o Whisper neste computador. Desmarque para uma análise mais rápida, sem as falas." }, transcrever, "Transcrever as falas"),
      h("span.espaco"),
      analisando ? h("span.suave", {}, "Análise em andamento…") : [
        ultimos.length > pendentes ? h("button", { aoClicar: analisar(true) }, "Analisar tudo de novo") : null,
        h("button.principal", { disabled: ultimos.length === 0, aoClicar: analisar(false) }, pendentes ? `Analisar ${pendentes} vídeo(s)` : "Analisar vídeos"),
      ],
    );
  };

  const desenharBrutos = (brutos) => {
    desenharBotoes(brutos);
    limpar(tabela).append(brutos.length === 0 ? h("div.vazio", {}, "Nenhum vídeo bruto neste projeto. Envie arquivos acima ou copie-os para a pasta do projeto.") : h("div.rolavel", {}, h("table", {},
      h("thead", {}, h("tr", {}, ["", "Arquivo", "Duração", "Imagem", "Situação", "Cenas", "Falas", "Problemas"].map((c) => h("th", {}, c)))),
      h("tbody", {}, brutos.map((b) => h("tr.clicavel", { aoClicar: () => agir(null, () => verBruto(id, b.id)), title: "Ver cenas, transcrição e dados técnicos" },
        h("td", {}, b.miniatura !== null ? h("img.miniatura", { src: `/api/projetos/${id}/brutos/${b.id}/miniaturas/${b.miniatura}`, loading: "lazy", alt: "" }) : h("div.miniatura")),
        h("td", {}, h("strong", {}, b.nome), h("div.suave", {}, b.existe ? tamanho(b.tamanhoBytes) : "Arquivo não encontrado no disco")),
        h("td", {}, tempo(b.tecnico?.duracaoSeg)), h("td", {}, b.tecnico ? `${b.tecnico.largura}×${b.tecnico.altura}` : "—"),
        h("td", {}, !b.existe ? etiqueta("Ausente", "ruim") : !b.analisado ? etiqueta("Não analisado") : etiqueta(...(INTEGRIDADE[b.integridade] ?? [b.integridade, ""]))),
        h("td", {}, b.analisado ? b.cenas : "—"), h("td", {}, b.analisado ? b.falas : "—"),
        h("td", {}, b.problemas.length ? etiqueta(String(b.problemas.length), b.problemas.some((p) => p.gravidade === "erro") ? "ruim" : "alerta") : b.analisado ? "Nenhum" : "—")))))));
  };
  const carregarBrutos = async () => desenharBrutos(await api(`/api/projetos/${id}/brutos`));

  const desenharReferencias = (todas) => {
    const vinculadas = todas.filter((r) => r.vinculada), outras = todas.filter((r) => !r.vinculada);
    const seletor = outras.length ? escolha([["", "Usar uma referência já cadastrada…"], ...outras.map((r) => [r.id, r.titulo])], "") : null;
    seletor?.addEventListener("change", () => seletor.value && agir(seletor, async () => {
      await api(`/api/projetos/${id}/referencias/${seletor.value}`, { metodo: "POST" });
      await carregarReferencias();
    }, "Referência associada ao projeto."));
    const pendentes = vinculadas.filter((r) => !r.analisada && r.existe);
    limpar(referencias).append(
      vinculadas.length === 0 ? h("div.vazio", {}, "Nenhuma referência neste projeto. Referências são vídeos prontos cujo estilo você quer que a aplicação observe.") : h("table", {},
        h("thead", {}, h("tr", {}, ["Referência", "Situação", ""].map((c) => h("th", {}, c)))),
        h("tbody", {}, vinculadas.map((r) => h("tr", {}, h("td", {}, h("strong", {}, r.titulo), h("div.suave", {}, `Adicionada em ${quando(r.criadoEm)}`)),
          h("td", {}, !r.existe ? etiqueta("Arquivo ausente", "ruim") : r.analisada ? etiqueta("Analisada", "bom") : etiqueta("Não analisada")),
          h("td", { style: "text-align:right" }, r.analisada ? h("button.pequeno", { aoClicar: (e) => agir(e, () => verRelatorioDaReferencia(r.id)) }, "Ver relatório") : null))))),
      h("div.linha", { style: "margin-top:12px" }, seletor ? h("div", { style: "max-width:320px;flex:1" }, seletor) : null, h("span.espaco"),
        pendentes.length ? h("button.principal", { aoClicar: (e) => agir(e, async () => {
          await api("/api/referencias/analisar", { metodo: "POST", corpo: { ids: pendentes.map((r) => r.id), transcrever: transcrever.checked } });
          aviso("Análise das referências iniciada.");
        }) }, `Analisar ${pendentes.length} referência(s)`) : null),
    );
  };
  const carregarReferencias = async () => desenharReferencias(await api(`/api/referencias?projeto=${id}`));

  const busca = h("input", { type: "search", placeholder: "Procurar nas falas, cenas e acontecimentos dos vídeos analisados" });
  const pesquisar = () => agir(null, async () => {
    const achados = busca.value.trim() ? await api(`/api/projetos/${id}/pesquisa?q=${encodeURIComponent(busca.value)}`) : null;
    limpar(resultados).append(achados === null ? null : achados.length === 0 ? h("div.suave", { style: "margin-top:10px" }, "Nada encontrado.") : h("ul.lista", { style: "margin-top:8px" },
      achados.map((r) => h("li", {}, h("time", {}, `${tempo(r.inicioSeg)}–${tempo(r.fimSeg)}`), h("span", {}, h("strong", {}, r.arquivo.split(/[\\/]/).pop()), ` — ${r.texto} `, etiqueta(r.tipo))))));
  });
  busca.addEventListener("keydown", (e) => { if (e.key === "Enter") pesquisar(); });

  const video = contexto.catalogo.extensoesDeVideo;
  raiz.append(
    h("section.bloco", {},
      h("h2", {}, "Vídeos brutos", h("span.acoes", {},
        h("button.pequeno", { aoClicar: (e) => agir(e, () => api("/api/abrir", { metodo: "POST", corpo: { alvo: "brutos", projetoId: id } })) }, "Abrir pasta"),
        h("button.pequeno", { title: "Registra os vídeos copiados direto para a pasta do projeto", aoClicar: (e) => agir(e, async () => {
          const r = await api(`/api/projetos/${id}/brutos/importar`, { metodo: "POST" });
          desenharBrutos(r.brutos);
          aviso(r.novos ? `${r.novos} vídeo(s) novo(s) encontrado(s).` : "Nenhum vídeo novo na pasta.");
        }) }, "Procurar novos arquivos"))),
      areaDeEnvio({
        texto: `Arraste os vídeos para cá (${video.join(", ")}). Os originais nunca são alterados.`, aceitos: video,
        destino: (arquivo) => `/api/projetos/${id}/brutos/arquivo?nome=${encodeURIComponent(arquivo.name)}`, aoTerminar: async () => { await carregarBrutos(); await estado.recarregarProjeto(); },
      }),
      h("div", { style: "margin:14px 0 10px" }, botoes), tabela),
    h("section.bloco", {}, h("h2", {}, "Pesquisa no material"), h("div.linha", {}, h("div", { style: "flex:1" }, busca), h("button", { aoClicar: pesquisar }, "Procurar")), resultados),
    h("section.bloco", {}, h("h2", {}, "Referências do projeto", h("a", { href: "#/referencias", style: "font-size:13px;font-weight:400" }, "Todas as referências")),
      areaDeEnvio({
        texto: "Arraste aqui vídeos de referência para este projeto.", aceitos: video,
        destino: (arquivo) => `/api/referencias/arquivo?nome=${encodeURIComponent(arquivo.name)}&perfil=${estado.projeto.perfil}&projeto=${id}`, aoTerminar: carregarReferencias,
      }),
      h("div", { style: "margin-top:14px" }, referencias)),
  );
  await Promise.all([carregarBrutos(), carregarReferencias()]);

  return {
    aoEvento: (nome, dados) => {
      if (nome !== "tarefa:atualizada" || !dados.tipo.startsWith("analise")) return;
      const ativa = dados.estado === "na-fila" || dados.estado === "executando";
      if (dados.tipo === "analise-de-brutos") analisando = ativa;
      if (!ativa) { carregarBrutos().catch(() => undefined); carregarReferencias().catch(() => undefined); estado.recarregarProjeto().catch(() => undefined); } else desenharBotoes([]);
    },
  };
}
