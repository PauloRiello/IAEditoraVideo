// Aba "Edição": montar a timeline, ver as faixas, ajustar itens, gerar e assistir à prévia.

import { agir, api, atualizarBarra, aviso, barra, campo, confirmar, dialogo, enviar, escolha, etiqueta, h, limpar, nomeDoArquivo, quando, tempo, por } from "/nucleo.js";

const FAIXAS = [["video", "Vídeo"], ["sobreposicao", "Sobreposição"], ["texto", "Textos"], ["legenda", "Legendas"], ["audio", "Áudio"]];
const faixaDe = (item) => (item.tipo === "texto" || item.tipo === "legenda" || item.tipo === "audio" ? item.tipo : item.camada === 0 ? "video" : "sobreposicao");
const rotuloDe = (item) => (item.tipo === "video" || item.tipo === "imagem" ? nomeDoArquivo(item.arquivo) : item.tipo === "audio" ? `${item.papel}: ${nomeDoArquivo(item.arquivo)}` : item.tipo === "cartao" ? item.titulo : item.texto);
const numero = (valor, propriedades = {}) => h("input", { type: "number", step: "0.1", value: valor, ...propriedades });

export async function aba(raiz, estado) {
  const id = estado.projeto.id;
  const { catalogo } = estado.contexto;
  const area = h("div");
  let dados = null, exportacoes = [], escolhido = null, video = null;
  const progresso = new Map(); // exportação em andamento → fração concluída

  const carregar = async () => {
    [dados, exportacoes] = await Promise.all([api(`/api/projetos/${id}/timeline`), api(`/api/projetos/${id}/exportacoes`)]);
    if (escolhido && !dados.atual?.timeline.itens.some((i) => i.id === escolhido)) escolhido = null;
    desenhar();
  };

  /** Aplica alterações à timeline (cada pedido vira uma versão nova). */
  const aplicar = (operacoes, nota, alvo) => agir(alvo ?? null, async () => {
    dados = await api(`/api/projetos/${id}/timeline/operacoes`, { metodo: "POST", corpo: { operacoes: [operacoes].flat(), nota } });
    if (escolhido && !dados.atual.timeline.itens.some((i) => i.id === escolhido)) escolhido = null;
    desenhar();
  });

  const gerarPrevia = (evento) => agir(evento, async () => {
    const e = await api(`/api/projetos/${id}/previa`, { metodo: "POST", corpo: {} });
    progresso.set(e.id, 0);
    exportacoes = await api(`/api/projetos/${id}/exportacoes`);
    desenhar();
  });

  function visor() {
    const versao = dados.atual.versao;
    const previas = exportacoes.filter((e) => e.tipo === "previa");
    const emAndamento = previas.find((e) => e.estado === "na-fila" || e.estado === "renderizando");
    const pronta = previas.find((e) => e.estado === "concluida" && e.arquivoExiste);
    const falha = previas[0]?.estado === "falhou" ? previas[0] : null;
    video = pronta ? h("video", { src: `/api/projetos/${id}/exportacoes/${pronta.id}/arquivo`, controls: true, preload: "metadata" }) : null;
    return h("div", {},
      h("div.visor", {}, video ?? h("div.vazio", {}, emAndamento ? "Gerando a prévia…" : "Ainda não há prévia. Gere uma para assistir à edição.")),
      h("div.linha", { style: "margin:10px 0 14px" },
        emAndamento
          ? [h("div", { style: "flex:1" }, h("small", {}, `Prévia da timeline v${emAndamento.versaoDaTimeline} em andamento`), barra(progresso.get(emAndamento.id) ?? emAndamento.progresso ?? 0)),
            h("button", { aoClicar: (ev) => agir(ev, () => api(`/api/projetos/${id}/exportacoes/${emAndamento.id}/cancelar`, { metodo: "POST" })) }, "Cancelar")]
          : [pronta ? h("small", {}, pronta.versaoDaTimeline === versao ? `Prévia da timeline v${versao}, em resolução reduzida.` : `Esta prévia é da versão ${pronta.versaoDaTimeline}; a timeline já está na v${versao}.`) : null,
            falha ? h("small", { style: "color:var(--ruim)" }, `A última prévia falhou: ${falha.erro}`) : null,
            h("span.espaco"), h("button.principal", { aoClicar: gerarPrevia }, pronta?.versaoDaTimeline === versao ? "Gerar prévia de novo" : "Gerar prévia"),
            h("a.botao", { href: `#/projeto/${id}/exportacao` }, "Exportar vídeo final")]));
  }

  function trilhas() {
    const t = dados.atual.timeline;
    const escala = Math.max(40, Math.min(160, 880 / Math.max(1, t.duracaoSeg)));
    const largura = Math.max(300, t.duracaoSeg * escala);
    const passo = t.duracaoSeg > 120 ? 10 : t.duracaoSeg > 40 ? 5 : t.duracaoSeg > 15 ? 2 : 1;
    const marcas = [];
    for (let s = 0; s <= t.duracaoSeg; s += passo) marcas.push(h("span", { style: `left:${s * escala}px` }, tempo(s)));
    return h("div.trilhas", {}, h("div", { style: `width:${largura}px` },
      h("div.regua", {}, marcas),
      FAIXAS.map(([faixa, nome]) => {
        const itens = t.itens.filter((i) => faixaDe(i) === faixa);
        if (itens.length === 0 && faixa === "sobreposicao") return null;
        return h("div.faixa", {}, h("b", {}, nome), itens.map((i) => h(`div.item.${i.tipo}${i.id === escolhido ? ".escolhido" : ""}`, {
          style: `left:${i.inicioSeg * escala}px;width:${Math.max(4, i.duracaoSeg * escala - 2)}px`, title: `${rotuloDe(i)} — ${tempo(i.inicioSeg)} a ${tempo(i.inicioSeg + i.duracaoSeg)}`,
          dados: { item: i.id }, aoClicar: () => { escolhido = i.id; desenhar(); if (video) video.currentTime = i.inicioSeg; },
        }, rotuloDe(i))));
      })));
  }

  function inspetorDoItem(item) {
    const t = dados.atual.timeline;
    const principal = faixaDe(item) === "video";
    const ordem = t.itens.filter((i) => faixaDe(i) === "video").sort((a, b) => a.inicioSeg - b.inicioSeg);
    const posicao = ordem.findIndex((i) => i.id === item.id);
    const campos = {};
    const linhas = [];
    const por = (nome, rotulo, controle, ajuda) => { campos[nome] = controle; linhas.push(campo(rotulo, controle, ajuda)); };

    if (!principal) por("inicioSeg", "Início (s)", numero(item.inicioSeg, { min: 0 }));
    por("duracaoSeg", "Duração (s)", numero(item.duracaoSeg, { min: 0.1 }));
    if (item.tipo === "texto" || item.tipo === "legenda") por("texto", "Texto", h("textarea", { value: item.texto }));
    if (item.tipo === "texto") {
      por("posicao", "Posição", escolha([["topo", "Topo"], ["centro", "Centro"], ["base", "Base"]], item.posicao));
      por("tamanho", "Tamanho da letra (% da altura)", numero(Math.round(item.tamanho * 1000) / 10, { min: 1, max: 20 }));
      por("cor", "Cor", h("input", { type: "color", value: /^#[0-9a-f]{6}$/i.test(item.cor) ? item.cor : "#ffffff" }));
      por("fundo", "Caixa atrás do texto", escolha([["", "Sem caixa"], ["rgba(0,0,0,0.6)", "Caixa escura"], ["rgba(255,255,255,0.85)", "Caixa clara"]], item.fundo), "A caixa garante a leitura sobre imagens claras.");
      por("animacao", "Animação", escolha([["nenhuma", "Nenhuma"], ["surgir", "Surgir"], ["subir", "Subir"]], item.animacao));
    }
    if (item.tipo === "cartao") { por("titulo", "Título", h("input", { value: item.titulo })); por("subtitulo", "Subtítulo", h("input", { value: item.subtitulo })); }
    if (item.tipo === "video" || item.tipo === "audio") por("volume", "Volume (0 = mudo, 1 = original)", numero(item.volume, { min: 0, max: 2, step: "0.05" }));
    if (item.tipo === "video") {
      por("cortarInicio", "Tirar do começo (s)", numero(0, { min: 0 }));
      por("zoom", "Aproximação (1 = sem zoom)", numero(item.enquadramento.zoom, { min: 1, max: 4, step: "0.05" }));
      if (posicao > 0) por("entrada", "Entrada", escolha([["corte", "Corte seco"], ["gradual", "Gradual"]], item.entrada.tipo));
    }

    const salvar = (evento) => {
      const v = (nome) => campos[nome]?.value;
      const n = (nome) => Number(v(nome));
      const operacoes = [], alterados = {};
      if (item.tipo === "video" && n("cortarInicio") > 0) operacoes.push({ tipo: "cortar", id: item.id, inicioSeg: n("cortarInicio") });
      const duracaoBase = item.duracaoSeg - (n("cortarInicio") || 0);
      if (Math.abs(n("duracaoSeg") - item.duracaoSeg) > 0.001 && Math.abs(n("duracaoSeg") - duracaoBase) > 0.001) operacoes.push({ tipo: "ajustar-duracao", id: item.id, duracaoSeg: n("duracaoSeg") });
      if (campos.inicioSeg && Math.abs(n("inicioSeg") - item.inicioSeg) > 0.001) operacoes.push({ tipo: "mover", id: item.id, inicioSeg: n("inicioSeg") });
      for (const nome of ["texto", "posicao", "cor", "fundo", "animacao", "titulo", "subtitulo"]) if (campos[nome] && v(nome) !== item[nome]) alterados[nome] = v(nome);
      if (campos.tamanho && Math.abs(n("tamanho") / 100 - item.tamanho) > 0.0005) alterados.tamanho = n("tamanho") / 100;
      if (campos.volume && n("volume") !== item.volume) alterados.volume = n("volume");
      if (campos.zoom && n("zoom") !== item.enquadramento.zoom) alterados.enquadramento = { zoom: n("zoom") };
      if (campos.entrada && v("entrada") !== item.entrada.tipo) alterados.entrada = v("entrada") === "gradual" ? { tipo: "gradual", duracaoSeg: 0.4 } : { tipo: "corte", duracaoSeg: 0 };
      if (Object.keys(alterados).length) operacoes.push({ tipo: "alterar", id: item.id, campos: alterados });
      if (operacoes.length === 0) return aviso("Nada foi alterado.");
      return aplicar(operacoes, `Ajuste em "${rotuloDe(item).slice(0, 40)}"`, evento);
    };
    const dividir = async (evento) => {
      const em = Math.round((item.duracaoSeg / 2) * 10) / 10;
      await aplicar({ tipo: "dividir", id: item.id, emSeg: em }, `Dividido em ${em} s`, evento);
    };
    const remover = async (evento) => {
      if (await confirmar("Remover este item?", `"${rotuloDe(item)}" sai da timeline. O arquivo original não é alterado, e a versão anterior continua no histórico.`, { rotulo: "Remover", perigo: true })) {
        await aplicar({ tipo: "remover", id: item.id }, `Removido "${rotuloDe(item).slice(0, 40)}"`, evento.target);
      }
    };

    return h("section.bloco.inspetor", {},
      h("h2", {}, h("span", {}, "Ajustes do item"), h("button.discreto.pequeno", { aoClicar: () => { escolhido = null; desenhar(); } }, "Fechar")),
      h("p", {}, etiqueta({ video: "Vídeo", imagem: "Imagem", cartao: "Cartão", texto: "Texto", legenda: "Legenda", audio: "Áudio" }[item.tipo]), " ", h("strong", {}, rotuloDe(item))),
      item.tipo === "video" ? h("p.suave", {}, `Trecho do original a partir de ${tempo(item.inicioOrigemSeg)}.`) : null,
      h("div", { style: "display:grid;gap:10px" }, linhas),
      h("div.linha", { style: "margin-top:14px" }, h("button.principal", { aoClicar: salvar }, "Aplicar"),
        principal && ordem.length > 1 ? [
          h("button", { disabled: posicao === 0, title: "Mover para antes", aoClicar: (e) => aplicar({ tipo: "reposicionar", id: item.id, posicao: posicao - 1 }, "Clipe movido para antes", e) }, "←"),
          h("button", { disabled: posicao === ordem.length - 1, title: "Mover para depois", aoClicar: (e) => aplicar({ tipo: "reposicionar", id: item.id, posicao: posicao + 1 }, "Clipe movido para depois", e) }, "→"),
        ] : null,
        item.duracaoSeg >= 0.4 && item.tipo !== "cartao" ? h("button", { aoClicar: dividir, title: "Divide o item ao meio em dois" }, "Dividir") : null,
        h("span.espaco"), h("button.perigo", { aoClicar: remover }, "Remover")));
  }

  function inspetorGeral() {
    const t = dados.atual.timeline;
    const barras = t.efeitosGlobais.some((e) => e.tipo === "barras-de-cinema");
    const tamanhoDaLegenda = numero(Math.round(t.legendas.tamanho * 1000) / 10, { min: 1, max: 12 });
    const caixa = h("input", { type: "checkbox", checked: t.legendas.caixa });
    const entradaDaTrilha = h("input", { type: "file", accept: catalogo.extensoesDeAudio.join(","), hidden: true });
    entradaDaTrilha.addEventListener("change", () => entradaDaTrilha.files[0] && agir(null, async () => {
      dados = await enviar(`/api/projetos/${id}/timeline/trilha?nome=${encodeURIComponent(entradaDaTrilha.files[0].name)}`, entradaDaTrilha.files[0]);
      desenhar();
    }, "Trilha sonora definida."));
    const adicionarTexto = (evento) => aplicar({
      tipo: "inserir",
      item: { id: "", tipo: "texto", camada: 20, inicioSeg: 0, duracaoSeg: Math.min(3, t.duracaoSeg), texto: "Novo texto", posicao: "topo", tamanho: 0.045, cor: "#ffffff", fundo: "rgba(0,0,0,0.6)", animacao: "surgir" },
    }, "Texto adicionado", evento);
    const comparar = (versao) => (evento) => agir(evento, async () => {
      const c = await api(`/api/projetos/${id}/timeline/comparacao?de=${versao}&para=${dados.atual.versao}`);
      dialogo({ titulo: `O que mudou da v${c.de} para a v${c.para}`, estreito: true, corpo: c.resumo.length ? h("ul", {}, c.resumo.map((r) => h("li", {}, r))) : h("p", {}, "Nenhuma diferença.") });
    });
    const restaurar = (versao) => async (evento) => {
      if (await confirmar(`Voltar à versão ${versao}?`, "A versão escolhida vira a mais recente. Nenhuma versão é apagada.", { rotulo: "Restaurar" })) {
        await agir(evento.target, async () => { dados = await api(`/api/projetos/${id}/timeline/restaurar`, { metodo: "POST", corpo: { versao } }); escolhido = null; desenhar(); }, `Versão ${versao} restaurada.`);
      }
    };
    return h("section.bloco.inspetor", {},
      h("h2", {}, "Ajustes gerais"),
      h("p.suave", {}, "Clique em um item da timeline para ajustá-lo. Cada alteração vira uma versão; nada é perdido."),
      h("div.linha", {}, h("button", { aoClicar: adicionarTexto }, "Adicionar texto"), h("button", { aoClicar: () => entradaDaTrilha.click() }, t.itens.some((i) => i.tipo === "audio" && i.papel === "trilha") ? "Trocar trilha sonora" : "Adicionar trilha sonora"), entradaDaTrilha),
      h("h3", { style: "margin-top:16px" }, "Legendas e efeitos"),
      h("div", { style: "display:grid;gap:10px" }, campo("Tamanho das legendas (% da altura)", tamanhoDaLegenda), h("label.marca-campo", {}, caixa, "Caixa escura atrás das legendas"),
        h("label.marca-campo", {}, h("input", { type: "checkbox", checked: barras, aoMudar: (e) => aplicar({ tipo: "efeito-global", efeito: { tipo: "barras-de-cinema", proporcao: 2.39 }, remover: !e.target.checked }, e.target.checked ? "Barras de cinema ligadas" : "Barras de cinema desligadas") }), "Barras de cinema")),
      h("button", { style: "margin-top:10px", aoClicar: (e) => aplicar({ tipo: "apresentacao", legendas: { tamanho: Number(tamanhoDaLegenda.value) / 100, caixa: caixa.checked } }, "Estilo das legendas alterado", e) }, "Aplicar às legendas"),
      h("h3", { style: "margin-top:16px" }, "Versões da timeline"),
      h("ul.lista", {}, dados.historico.slice(0, 8).map((v) => h("li", { style: "display:block" },
        h("div.linha", {}, h("strong", {}, `v${v.versao}`), v.versao === dados.atual.versao ? etiqueta("Atual", "destaque") : null, h("small", {}, `${v.autor === "ia" ? "Aplicação" : "Você"} · ${quando(v.criadoEm)}`), h("span.espaco"),
          v.versao !== dados.atual.versao ? [h("button.pequeno", { aoClicar: comparar(v.versao) }, "Comparar"), h("button.pequeno", { aoClicar: restaurar(v.versao) }, "Restaurar")] : null),
        h("small", {}, v.nota)))));
  }

  function desenhar() {
    limpar(area);
    if (!dados.atual) {
      const estilos = catalogo.estilos.map((e) => h("label.marca-campo", { title: e.descricao }, h("input", { type: "checkbox", value: e.id, checked: estado.projeto.configuracao.estilos.includes(e.id) }), e.nome));
      const montar = (evento) => agir(evento, async () => {
        const r = await api(`/api/projetos/${id}/timeline/montar`, { metodo: "POST", corpo: { estilos: estilos.map((e) => e.firstChild).filter((c) => c.checked).map((c) => c.value) } });
        for (const a of r.avisos) aviso(a);
        await estado.recarregarProjeto();
        await carregar();
      }, "Timeline montada.");
      por(area, h("section.bloco", {}, h("h2", {}, "Montar a timeline"),
        !dados.planoAprovado
          ? h("div.nota.alerta", {}, "A edição só começa depois que o plano for aprovado. ", h("a", { href: `#/projeto/${id}/plano` }, "Abrir o plano"))
          : [h("p", {}, "A aplicação monta a timeline a partir do plano aprovado, usando só os recursos que o estilo, a memória ou as referências pedem."),
            h("div.linha", { style: "gap:6px 16px;margin-bottom:14px" }, estilos), h("button.principal", { aoClicar: montar }, "Montar timeline")]));
      return;
    }
    const t = dados.atual.timeline;
    const item = escolhido ? t.itens.find((i) => i.id === escolhido) : null;
    const remontar = async (evento) => {
      if (await confirmar("Montar de novo?", "Uma nova versão da timeline será montada a partir do plano aprovado. Seus ajustes continuam nas versões anteriores.", { rotulo: "Montar de novo" })) {
        await agir(evento.target, async () => { const r = await api(`/api/projetos/${id}/timeline/montar`, { metodo: "POST", corpo: {} }); for (const a of r.avisos) aviso(a); await carregar(); }, "Timeline montada de novo.");
      }
    };
    const avisoDaMarca = dados.marcaDesatualizada ? h("div.nota.alerta", { style: "margin-bottom:10px" },
      "A marca do projeto mudou depois desta montagem. ",
      h("button.pequeno", { aoClicar: (e) => agir(e, async () => { dados = await api(`/api/projetos/${id}/timeline/aplicar-marca`, { metodo: "POST", corpo: {} }); desenhar(); }, "Marca atual aplicada; suas edições continuam.") }, "Aplicar marca atual")) : null;
    por(area, h("div.editor", {},
      h("div", {}, avisoDaMarca, visor(),
        h("div.linha", { style: "margin-bottom:8px" }, h("strong", {}, `Timeline v${dados.atual.versao}`), h("span.suave", {}, `${t.formato.largura}×${t.formato.altura}, ${t.formato.fps} fps · ${tempo(t.duracaoSeg)} · ${t.itens.length} item(ns)`), h("span.espaco"),
          dados.historico.length > 1 ? h("button.pequeno", { title: "Volta à versão anterior", aoClicar: (e) => agir(e, async () => { dados = await api(`/api/projetos/${id}/timeline/restaurar`, { metodo: "POST", corpo: {} }); escolhido = null; desenhar(); }, "Alteração desfeita.") }, "Desfazer") : null,
          h("button.pequeno", { aoClicar: remontar }, "Montar de novo")),
        trilhas(),
        dados.montagem?.decisoes?.length ? h("details", { style: "margin-top:12px" }, h("summary.suave", {}, "Por que a aplicação montou assim"),
          h("ul.lista", {}, dados.montagem.decisoes.map((d) => h("li", {}, h("span", {}, h("strong", {}, d.aspecto), `: ${d.decisao} `, etiqueta(d.origem)))))) : null),
      item ? inspetorDoItem(item) : inspetorGeral()));
  }

  por(raiz, area);
  await carregar();

  return {
    aoEvento: (nome, e) => {
      if (nome === "render:progresso") {
        progresso.set(e.id, e.progresso);
        atualizarBarra(area.querySelector(".visor + .linha .progresso"), e.progresso);
      } else if (nome === "render:atualizado" && e.tipo === "previa" && e.estado !== "renderizando") {
        if (e.estado !== "na-fila") progresso.delete(e.id);
        api(`/api/projetos/${id}/exportacoes`).then((lista) => { exportacoes = lista; desenhar(); estado.recarregarProjeto().catch(() => undefined); }).catch(() => undefined);
      }
    },
  };
}
