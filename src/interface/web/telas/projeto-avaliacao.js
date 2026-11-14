// Aba "Avaliação": aprovar, rejeitar ou pedir alterações na edição, dar notas, marcar trechos e registrar resultados.

import { agir, api, aviso, campo, confirmar, escolha, etiqueta, h, limpar, quando, tempo } from "/nucleo.js";

const DECISOES = { aprovada: ["Aprovada", "bom"], rejeitada: ["Rejeitada", "ruim"], "alteracoes-solicitadas": ["Alterações solicitadas", "alerta"] };
const ASPECTOS = { roteiro: "Roteiro", ritmo: "Ritmo", cortes: "Cortes", efeitos: "Efeitos", audio: "Áudio", resultado: "Resultado" };
const METRICAS = [["visualizacoes", "Visualizações"], ["retencaoPercentual", "Retenção média (%)"], ["tempoAssistidoSeg", "Tempo assistido (s)"], ["curtidas", "Curtidas"], ["comentarios", "Comentários"],
  ["compartilhamentos", "Compartilhamentos"], ["cliques", "Cliques"], ["conversoes", "Conversões"], ["entradasNoDiscord", "Entradas no Discord"], ["novosJogadores", "Novos jogadores"]];
const SINAIS = { acima: "acima do usual", abaixo: "abaixo do usual", dentro: "dentro do usual", insuficiente: "sem resultados comparáveis ainda" };

export async function aba(raiz, estado) {
  const id = estado.projeto.id;
  const lista = h("div"), resultados = h("div");
  const timeline = (await api(`/api/projetos/${id}/timeline`)).atual;

  // Formulário de avaliação
  const decisao = escolha([["aprovada", "Aprovar a edição"], ["alteracoes-solicitadas", "Pedir alterações"], ["rejeitada", "Rejeitar a edição"]], "aprovada");
  const motivo = h("textarea", { placeholder: "Obrigatório ao rejeitar ou pedir alterações." });
  const notas = {};
  const estrelas = Object.entries(ASPECTOS).map(([aspecto, nome]) => {
    const botoes = [1, 2, 3, 4, 5].map((n) => h("button", { type: "button", "aria-label": `${nome}: nota ${n}`, aoClicar: () => {
      notas[aspecto] = notas[aspecto] === n ? undefined : n;
      botoes.forEach((b, i) => b.classList.toggle("ligada", notas[aspecto] !== undefined && i < notas[aspecto]));
    } }, n));
    return h("div.linha", {}, h("span", { style: "min-width:90px" }, nome), h("span.estrelas", {}, botoes));
  });
  const trechos = h("div", { style: "display:grid;gap:8px" });
  const novoTrecho = () => trechos.append(h("div.linha", {},
    h("input", { type: "number", min: 0, step: "0.1", placeholder: "Início (s)", style: "width:110px" }), h("input", { type: "number", min: 0, step: "0.1", placeholder: "Fim (s)", style: "width:110px" }),
    h("input", { placeholder: "O que precisa ser revisto neste trecho", style: "flex:1;min-width:200px" }), h("button.discreto", { type: "button", aoClicar: (e) => e.target.parentElement.remove() }, "Remover")));
  const enviar = (evento) => agir(evento, async () => {
    const marcados = [...trechos.children].map((linha) => { const [a, b, c] = linha.querySelectorAll("input"); return { inicioSeg: Number(a.value), fimSeg: Number(b.value), comentario: c.value.trim() }; })
      .filter((t) => t.comentario && t.fimSeg > t.inicioSeg);
    const r = await api(`/api/projetos/${id}/avaliacoes`, { metodo: "POST", corpo: { decisao: decisao.value, motivo: motivo.value, notas: Object.fromEntries(Object.entries(notas).filter(([, n]) => n)), trechos: marcados } });
    const a = r.aprendizado;
    aviso(a.correcoes.length || a.confirmados || a.contestados
      ? `Avaliação registrada: ${a.correcoes.length} correção(ões) aprendida(s), ${a.confirmados} aprendizado(s) confirmado(s), ${a.contestados} contestado(s).`
      : "Avaliação registrada. Sem notas nem correções apontadas, ela não muda o que a aplicação aprendeu.", "sucesso");
    motivo.value = "";
    limpar(trechos);
    await carregar();
  });

  // Resultados publicados
  const plataforma = h("input", { value: estado.projeto.configuracao.plataforma, placeholder: "Onde o vídeo foi publicado" });
  const metricas = METRICAS.map(([chave, nome]) => [chave, h("input", { type: "number", min: 0, placeholder: nome })]);
  const evidencia = h("input", { placeholder: "Como se sabe que os novos jogadores vieram deste vídeo" });
  const registrar = (evento) => agir(evento, async () => {
    const valores = Object.fromEntries(metricas.filter(([, entrada]) => entrada.value !== "").map(([chave, entrada]) => [chave, Number(entrada.value)]));
    await api(`/api/projetos/${id}/resultados`, { metodo: "POST", corpo: { plataforma: plataforma.value, metricas: valores, evidenciaDeAtribuicao: evidencia.value } });
    for (const [, entrada] of metricas) entrada.value = "";
    await carregar();
  }, "Resultado registrado.");

  const desenhar = (d) => {
    limpar(lista).append(
      d.trechos.some((t) => !t.resolvido) ? [h("h3", {}, "Trechos aguardando revisão"), h("ul.lista", { style: "margin-bottom:14px" }, d.trechos.filter((t) => !t.resolvido).map((t) => h("li", {},
        h("time", {}, `${tempo(t.inicioSeg)}–${tempo(t.fimSeg)}`), h("span", { style: "flex:1" }, t.comentario),
        h("button.pequeno", { aoClicar: (e) => agir(e, async () => { await api(`/api/trechos/${t.id}/resolver`, { metodo: "POST", corpo: {} }); await carregar(); }) }, "Marcar como resolvido"))))] : null,
      d.avaliacoes.length === 0 ? h("div.vazio", {}, "Nenhuma avaliação ainda.") : h("ul.lista", {}, d.avaliacoes.map((a) => h("li", { style: "display:block" },
        h("div.linha", {}, etiqueta(...DECISOES[a.decisao]), h("strong", {}, `Timeline v${a.versaoDaTimeline}`), h("small", {}, quando(a.criadoEm)), a.desfeita ? etiqueta("Desfeita") : null, h("span.espaco"),
          !a.desfeita ? h("button.pequeno", { title: "Retira o que esta avaliação ensinou. A avaliação continua no histórico.", aoClicar: async (e) => {
            if (await confirmar("Desfazer o que esta avaliação ensinou?", "Os aprendizados voltam ao estado anterior a ela.", { rotulo: "Desfazer" })) await agir(e.target, async () => { await api(`/api/avaliacoes/${a.id}/desfazer`, { metodo: "POST" }); await carregar(); }, "Aprendizado desfeito.");
          } }, "Desfazer aprendizado") : null),
        a.motivo ? h("div", {}, a.motivo) : null,
        Object.keys(a.notas).length ? h("small", {}, Object.entries(a.notas).map(([aspecto, nota]) => `${ASPECTOS[aspecto] ?? aspecto} ${nota}/5`).join(" · ")) : null))),
    );
    limpar(resultados).append(d.resultados.length === 0 ? h("div.suave", {}, "Nenhum resultado registrado.") : h("ul.lista", {}, d.resultados.map((r) => h("li", { style: "display:block" },
      h("div.linha", {}, h("strong", {}, r.plataforma), h("small", {}, quando(r.criadoEm)), h("span.espaco"),
        h("button.pequeno", { aoClicar: (e) => agir(e, async () => { await api(`/api/resultados/${r.id}`, { metodo: "DELETE" }); await carregar(); }, "Resultado removido.") }, "Remover")),
      h("small", {}, METRICAS.filter(([chave]) => r.metricas[chave] !== undefined).map(([chave, nome]) => `${nome}: ${r.metricas[chave]}`).join(" · ")),
      h("div.suave", {}, `Leitura: ${SINAIS[r.leitura.sinal] ?? r.leitura.sinal}${r.leitura.comparaveis ? ` (${r.leitura.comparaveis} resultado(s) comparável(is))` : ""}.`)))));
  };
  const carregar = async () => desenhar(await api(`/api/projetos/${id}/avaliacoes`));

  raiz.append(
    h("div.grade.duas", {},
      h("section.bloco", {}, h("h2", {}, "Avaliar a edição"),
        !timeline ? h("div.nota.alerta", {}, "Ainda não há edição para avaliar.") : [
          h("p.suave", {}, `Você está avaliando a timeline v${timeline.versao}. As notas e as correções que você fez na timeline ensinam a aplicação; uma rejeição sem aspecto apontado não ensina nada.`),
          h("div", { style: "display:grid;gap:12px" }, campo("Decisão", decisao), campo("Motivo", motivo),
            h("div", {}, h("div.campo", { style: "font-size:12.5px;color:var(--suave);margin-bottom:6px" }, "Notas de 1 a 5 (opcionais)"), h("div", { style: "display:grid;gap:6px" }, estrelas)),
            h("div", {}, h("div.linha", { style: "margin-bottom:6px" }, h("span.suave", { style: "font-size:12.5px" }, "Trechos que precisam de revisão"), h("button.pequeno", { type: "button", aoClicar: novoTrecho }, "Adicionar trecho")), trechos)),
          h("button.principal", { style: "margin-top:14px", aoClicar: enviar }, "Registrar avaliação")]),
      h("section.bloco", {}, h("h2", {}, "Avaliações anteriores"), lista)),
    h("section.bloco", {}, h("h2", {}, "Resultados depois de publicado"),
      h("p.suave", {}, "Opcional. Informe só números reais da plataforma: eles são um sinal fraco, nunca criam uma regra sozinhos, e a aplicação não estima nem inventa métricas."),
      h("div.formulario", {}, campo("Plataforma", plataforma), metricas.map(([chave, entrada]) => campo(METRICAS.find(([c]) => c === chave)[1], entrada)), h("div.larga", {}, campo("Evidência de atribuição", evidencia, "Exigida para registrar novos jogadores."))),
      h("button", { style: "margin:14px 0", aoClicar: registrar }, "Registrar resultado"), resultados),
  );
  await carregar();
  return {};
}
