// Aba "Exportação": preset, destino, conferência de qualidade, exportação final, relatórios e histórico.

import { agir, api, aviso, barra, campo, confirmar, dialogo, escolha, etiqueta, h, limpar, nomeDoArquivo, perguntar, quando, tamanho, tempo } from "/nucleo.js";

const SITUACOES = { aprovado: ["Aprovado", "bom"], "aprovado-com-ressalvas": ["Aprovado com ressalvas", "bom"], pendente: ["Pendente: precisa da sua decisão", "alerta"], reprovado: ["Reprovado", "ruim"] };
const GRAVIDADES = { obrigatoria: ["Obrigatória", "ruim"], importante: ["Importante", "alerta"], recomendacao: ["Recomendação", "info"] };
const ESTADOS = { "na-fila": ["Na fila", "info"], renderizando: ["Renderizando", "destaque"], concluida: ["Concluída", "bom"], falhou: ["Falhou", "ruim"], cancelada: ["Cancelada", "alerta"] };

/** Mostra um relatório de qualidade. Em relatórios de exportação, permite aceitar problemas não críticos. */
export function mostrarRelatorio(projetoId, relatorio, aoMudar) {
  const corpo = h("div");
  const desenhar = (r) => {
    const reprovadas = r.verificacoes.filter((v) => v.situacao === "reprovada").sort((a, b) => Object.keys(GRAVIDADES).indexOf(a.gravidade) - Object.keys(GRAVIDADES).indexOf(b.gravidade));
    const aprovadas = r.verificacoes.filter((v) => v.situacao === "aprovada");
    const outras = r.verificacoes.filter((v) => v.situacao !== "aprovada" && v.situacao !== "reprovada");
    const aceitar = (v) => async (evento) => {
      const justificativa = await perguntar("Aceitar este problema?", `Por que “${v.nome}” pode ficar como está? A justificativa fica registrada no relatório.`, { rotuloDoBotao: "Aceitar exceção", longo: true });
      if (justificativa === null) return;
      await agir(evento.target, async () => {
        const novo = await api(`/api/projetos/${projetoId}/relatorios/${r.id}/excecoes`, { metodo: "POST", corpo: { verificacaoId: v.id, justificativa } });
        desenhar(novo.relatorio);
        aoMudar?.();
      }, "Exceção registrada.");
    };
    limpar(corpo).append(
      h("div.linha", { style: "margin-bottom:12px" }, etiqueta(...(SITUACOES[r.situacao] ?? [r.situacao, ""])), h("span.suave", {}, `Destino: ${r.perfilDeQualidade} · timeline v${r.versaoDaTimeline} · ${quando(r.criadoEm)}`)),
      r.arquivo ? h("p.suave", {}, r.arquivo) : h("p.suave", {}, "Conferência da timeline, antes de renderizar."),
      h("p", {}, `${aprovadas.length} verificação(ões) aprovada(s), ${reprovadas.length} com problema, ${outras.length} que não se aplicam.`),
      h("h3", {}, "Problemas encontrados"),
      reprovadas.length === 0 ? h("div.nota.bom", {}, "Nenhum problema encontrado.") : h("ul.lista", {}, reprovadas.map((v) => {
        const excecao = r.excecoes.find((e) => e.verificacaoId === v.id);
        return h("li", { style: "display:block" },
          h("div.linha", {}, etiqueta(...GRAVIDADES[v.gravidade]), h("strong", {}, v.nome), v.base === "estimado" ? etiqueta("Estimativa") : null, h("span.espaco"),
            excecao ? etiqueta("Aceito por você", "bom") : v.gravidade === "obrigatoria" ? etiqueta("Precisa ser corrigido", "ruim")
              : v.gravidade === "importante" && r.exportacaoId !== null ? h("button.pequeno", { aoClicar: aceitar(v) }, "Aceitar como está") : null),
          h("div", {}, v.detalhe), excecao ? h("div.suave", {}, `Justificativa: ${excecao.justificativa}`) : v.sugestao ? h("div.suave", {}, `Como corrigir: ${v.sugestao}`) : null);
      })),
      h("details", { style: "margin-top:14px" }, h("summary", {}, `Verificações aprovadas (${aprovadas.length})`), h("ul.lista", {}, aprovadas.map((v) => h("li", {}, h("span", {}, h("strong", {}, v.nome), ` — ${v.detalhe}`))))),
      outras.length ? h("details", { style: "margin-top:8px" }, h("summary", {}, `Não se aplicam a este vídeo (${outras.length})`), h("ul.lista", {}, outras.map((v) => h("li", {}, h("span", {}, h("strong", {}, v.nome), ` — ${v.detalhe}`))))) : null,
    );
  };
  desenhar(relatorio);
  dialogo({ titulo: "Relatório de qualidade", corpo });
}

export async function aba(raiz, estado) {
  const id = estado.projeto.id;
  const { catalogo } = estado.contexto;
  const historico = h("div"), andamento = h("div");
  const progresso = new Map();
  const preset = escolha(catalogo.presets.map((p) => [p.id, p.nome]), "padrao");
  const destino = escolha([["", "Escolher pelo projeto (plataforma, perfil e formato)"], ...catalogo.destinos.map((d) => [d.id, d.nome])], "");
  const timeline = (await api(`/api/projetos/${id}/timeline`)).atual;

  const conferir = (evento) => agir(evento, async () => mostrarRelatorio(id, await api(`/api/projetos/${id}/qualidade`, { metodo: "POST", corpo: { destino: destino.value } })));
  const exportar = (evento) => agir(evento, async () => {
    const e = await api(`/api/projetos/${id}/exportar`, { metodo: "POST", corpo: { preset: preset.value, destino: destino.value } });
    progresso.set(e.id, 0);
    aviso("Exportação iniciada. O arquivo só entra na pasta de exportações depois de conferido.");
    await carregar();
  });

  const desenhar = (lista) => {
    const ativas = lista.filter((e) => e.estado === "na-fila" || e.estado === "renderizando");
    limpar(andamento).append(ativas.map((e) => h("div.nota", {}, h("div.linha", {},
      h("div", { style: "flex:1" }, h("strong", {}, `${e.tipo === "previa" ? "Prévia" : "Exportação"} da timeline v${e.versaoDaTimeline}`), h("div", { dados: { exportacao: e.id } }, barra(progresso.get(e.id) ?? e.progresso ?? 0))),
      h("button", { aoClicar: (ev) => agir(ev, () => api(`/api/projetos/${id}/exportacoes/${e.id}/cancelar`, { metodo: "POST" })) }, "Cancelar")))));
    const finais = lista.filter((e) => e.tipo === "final");
    limpar(historico).append(finais.length === 0 ? h("div.vazio", {}, "Nenhum vídeo exportado ainda.") : h("div.rolavel", {}, h("table", {},
      h("thead", {}, h("tr", {}, ["Data", "Versão", "Preset", "Situação", "Arquivo", "Qualidade", ""].map((c) => h("th", {}, c)))),
      h("tbody", {}, finais.map((e) => h("tr", {},
        h("td", {}, quando(e.criadoEm)), h("td", {}, `v${e.versaoDaTimeline}`), h("td", {}, e.preset ?? "padrão"), h("td", {}, etiqueta(...(ESTADOS[e.estado] ?? [e.estado, ""]))),
        h("td", {}, e.arquivo ? [h("div", {}, nomeDoArquivo(e.arquivo)), h("small", {}, e.largura ? `${e.largura}×${e.altura}, ${e.fps} fps, ${tempo(e.duracaoSeg)}, ${tamanho(e.tamanhoBytes)}` : ""), e.arquivo && !e.arquivoExiste ? h("div", {}, etiqueta("Arquivo movido ou apagado", "alerta")) : null] : h("small", { style: "color:var(--ruim)" }, e.erro ?? "—")),
        h("td", {}, e.relatorio ? etiqueta(...(SITUACOES[e.relatorio.situacao] ?? [e.relatorio.situacao, ""])) : "—"),
        h("td", { style: "text-align:right;white-space:nowrap" },
          e.relatorio ? h("button.pequeno", { aoClicar: (ev) => agir(ev, async () => mostrarRelatorio(id, (await api(`/api/projetos/${id}/exportacoes/${e.id}/relatorio`)).relatorio, carregar)) }, "Relatório") : null, " ",
          e.estado === "concluida" && e.arquivoExiste ? h("button.pequeno", { aoClicar: () => dialogo({ titulo: nomeDoArquivo(e.arquivo), corpo: h("div.visor", {}, h("video", { src: `/api/projetos/${id}/exportacoes/${e.id}/arquivo`, controls: true, autoplay: true })) }) }, "Assistir") : null, " ",
          e.estado !== "na-fila" && e.estado !== "renderizando" ? h("button.pequeno", { title: "Exporta de novo a mesma versão com o mesmo preset, em arquivo novo", aoClicar: async (ev) => {
            if (await confirmar("Repetir esta exportação?", "A mesma versão da timeline será exportada de novo, em um arquivo novo. O anterior não é sobrescrito.", { rotulo: "Repetir" })) await agir(ev.target, async () => { await api(`/api/projetos/${id}/exportacoes/${e.id}/repetir`, { metodo: "POST" }); await carregar(); });
          } }, "Repetir") : null)))))));
  };
  const carregar = async () => desenhar(await api(`/api/projetos/${id}/exportacoes`));

  raiz.append(
    h("section.bloco", {}, h("h2", {}, "Exportar o vídeo final"),
      !timeline ? h("div.nota.alerta", {}, "Ainda não há timeline para exportar. ", h("a", { href: `#/projeto/${id}/edicao` }, "Abrir a edição")) : [
        h("p", {}, `Será exportada a timeline v${timeline.versao} (${timeline.timeline.formato.largura}×${timeline.timeline.formato.altura}, ${tempo(timeline.timeline.duracaoSeg)}), em MP4 com H.264 e AAC. O arquivo é conferido antes de entrar na pasta de exportações, e um arquivo existente nunca é sobrescrito.`),
        h("div.formulario", {}, campo("Preset", preset, "Presets com proporção diferente da timeline são recusados: a exportação não distorce a imagem."),
          campo("Destino (critérios de qualidade)", destino, "Cada destino tem os seus critérios: regras de redes sociais não valem para documentários.")),
        h("div.linha", { style: "margin-top:14px" }, h("button", { aoClicar: conferir }, "Conferir qualidade antes"), h("button.principal", { aoClicar: exportar }, "Exportar vídeo final"), h("span.espaco"),
          h("button", { aoClicar: (e) => agir(e, () => api("/api/abrir", { metodo: "POST", corpo: { alvo: "exportacoes", projetoId: id } })) }, "Abrir pasta de exportações")),
      ], h("div", { style: "margin-top:14px" }, andamento)),
    h("section.bloco", {}, h("h2", {}, "Histórico de arquivos exportados"), historico),
  );
  await carregar();

  return {
    aoEvento: (nome, e) => {
      if (nome === "render:progresso") {
        progresso.set(e.id, e.progresso);
        const fracao = andamento.querySelector(`[data-exportacao="${e.id}"] .barra > i`);
        if (fracao) fracao.style.width = `${Math.round(e.progresso * 100)}%`;
      } else if (nome === "render:atualizado" && e.estado !== "renderizando") {
        if (e.estado !== "na-fila") progresso.delete(e.id);
        carregar().catch(() => undefined);
        estado.recarregarProjeto().catch(() => undefined);
      }
    },
  };
}
