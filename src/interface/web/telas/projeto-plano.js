// Aba "Plano e roteiro": gerar, revisar, aprovar ou rejeitar o plano de edição e escrever o roteiro.

import { agir, api, aviso, etiqueta, h, limpar, nomeDoArquivo, perguntar, quando, tempo, por } from "/nucleo.js";

const ESTADOS = { rascunho: ["Aguardando aprovação", "alerta"], aprovado: ["Aprovado", "bom"], rejeitado: ["Rejeitado", "ruim"] };
const BLOCOS = { abertura: "Abertura", desenvolvimento: "Desenvolvimento", climax: "Clímax", encerramento: "Encerramento" };
const TIPOS_DE_LINHA = { narracao: "Narração", "texto-na-tela": "Texto na tela", "fala-original": "Fala original", imagem: "Imagem" };
const ORIGENS = { briefing: "configuração do projeto", aprendizado: "aprendizado", referencia: "referência", perfil: "perfil", padrao: "padrão" };

export async function aba(raiz, estado) {
  const id = estado.projeto.id;
  const area = h("div");

  const acao = (caminho, corpo, sucesso, depois) => (evento) => agir(evento, async () => {
    const r = await api(`/api/projetos/${id}/${caminho}`, { metodo: "POST", corpo });
    await estado.recarregarProjeto();
    desenhar(r);
    depois?.(r);
  }, sucesso);

  const rejeitar = async (evento) => {
    const motivo = await perguntar("Rejeitar o plano", "O que precisa mudar? (fica registrado no histórico do projeto)", { obrigatorio: false, rotuloDoBotao: "Rejeitar plano", longo: true });
    if (motivo !== null) await acao("plano/rejeitar", { motivo }, "Plano rejeitado.")(evento.target);
  };

  const aposAprovar = (r) => {
    for (const a of r.avisos ?? []) aviso(a);
    if (r.timelineMontada) { aviso(`Timeline v${r.timelineMontada} montada${r.previaIniciada ? "; a prévia está sendo gerada" : ""}.`, "sucesso"); estado.irParaAba("edicao"); }
  };

  function desenhar(d) {
    limpar(area);
    const v = d.atual, p = v?.plano;
    if (!v) {
      por(area, h("section.bloco", {}, h("h2", {}, "Plano de edição"),
        h("p", {}, "O plano diz quais trechos entram no vídeo, em que ordem e por quê. Ele é gerado a partir do objetivo do projeto e do material analisado, e a edição só começa depois que você aprovar."),
        !d.pronto.objetivo ? h("div.nota.alerta", {}, "Falta informar o objetivo do vídeo. ", h("a", { href: `#/projeto/${id}/visao` }, "Abrir a configuração do projeto")) : null,
        !d.pronto.material ? h("div.nota.alerta", {}, "Falta analisar os vídeos brutos. ", h("a", { href: `#/projeto/${id}/material` }, "Abrir material e análise")) : null,
        h("button.principal", { disabled: !d.pronto.objetivo || !d.pronto.material, aoClicar: acao("plano", {}, "Plano gerado.") }, "Gerar plano de edição")));
    } else {
      const [rotulo, tipo] = ESTADOS[v.estado];
      por(area, 
        h("section.bloco", {},
          h("h2", {}, h("span", {}, `Plano de edição — versão ${v.versao} `, etiqueta(rotulo, tipo)),
            h("span.acoes", {},
              h("button", { aoClicar: acao("plano", {}, "Nova versão do plano gerada."), title: "Gera outra versão com a configuração atual do projeto. A nova versão precisa ser aprovada." }, "Gerar nova versão"),
              v.estado === "rascunho" ? [h("button.perigo", { aoClicar: rejeitar }, "Rejeitar"), h("button.principal", { aoClicar: acao("plano/aprovar", {}, "Plano aprovado.", aposAprovar) }, "Aprovar plano")] : null,
              v.estado === "aprovado" ? h("a.botao", { href: `#/projeto/${id}/edicao` }, "Ir para a edição") : null)),
          p.avisos.map((a) => h("div.nota.alerta", {}, a)),
          h("dl.chaves", {},
            h("dt", {}, "Objetivo"), h("dd", {}, p.objetivo),
            p.publico ? [h("dt", {}, "Público"), h("dd", {}, p.publico)] : null, p.plataforma ? [h("dt", {}, "Plataforma"), h("dd", {}, p.plataforma)] : null,
            h("dt", {}, "Formato"), h("dd", {}, `${p.formato.largura}×${p.formato.altura}, ${p.formato.fps} fps`),
            h("dt", {}, "Duração"), h("dd", {}, `${p.duracaoPlanejadaSeg} s planejados (desejado: ${p.duracaoDesejadaSeg} s)`),
            h("dt", {}, "Transições"), h("dd", {}, `${p.transicoes.padrao}; encerramento com ${p.transicoes.encerramento}`),
            h("dt", {}, "Áudio original"), h("dd", {}, p.audio.descricao),
            h("dt", {}, "Legendas"), h("dd", {}, p.legendas.ativas ? `${p.legendas.itens.length} legenda(s). ${p.legendas.observacao}` : `Sem legendas. ${p.legendas.observacao}`),
            h("dt", {}, "Trilha sonora"), h("dd", {}, p.trilhaSonora.observacao),
            h("dt", {}, "Chamada para ação"), h("dd", {}, p.cta ? `“${p.cta.texto}” aos ${tempo(p.cta.inicioSeg)}` : "Nenhuma (não foi informada na configuração do projeto)"),
            p.efeitos.length ? [h("dt", {}, "Efeitos"), h("dd", {}, p.efeitos.join(" "))] : null)),
        h("section.bloco", {}, h("h2", {}, `Trechos escolhidos (${p.clipes.length})`), h("div.rolavel", {}, h("table", {},
          h("thead", {}, h("tr", {}, ["#", "No vídeo", "Parte", "Arquivo", "Trecho do original", "Por que entrou"].map((c) => h("th", {}, c)))),
          h("tbody", {}, p.clipes.map((c, i) => h("tr", {}, h("td", {}, i + 1), h("td", {}, tempo(c.inicioLinhaDoTempoSeg)), h("td", {}, BLOCOS[c.bloco] ?? c.bloco),
            h("td", {}, nomeDoArquivo(c.arquivo)), h("td", {}, `${tempo(c.inicioOrigemSeg)}–${tempo(c.fimOrigemSeg)}`), h("td", {}, c.motivo))))))),
        h("div.grade.duas", {},
          h("section.bloco", {}, h("h2", {}, "Estrutura"), h("ul.lista", {}, p.estruturaNarrativa.map((b) => h("li", {}, h("time", {}, `${tempo(b.inicioSeg)}–${tempo(b.fimSeg)}`), h("span", {}, h("strong", {}, BLOCOS[b.bloco] ?? b.bloco), ` — ${b.descricao}`))))),
          h("section.bloco", {}, h("h2", {}, "De onde veio cada escolha"), p.decisoes.length
            ? h("ul.lista", {}, p.decisoes.map((x) => h("li", {}, h("span", {}, h("strong", {}, x.aspecto), `: ${x.decisao} `, etiqueta(ORIGENS[x.origem] ?? x.origem)))))
            : h("div.suave", {}, "Nenhuma escolha registrada."))),
      );
    }

    const r = d.roteiro;
    por(area, h("section.bloco", {},
      h("h2", {}, "Roteiro", v ? h("button", { aoClicar: acao("roteiro", {}, "Roteiro escrito.") }, r ? "Escrever de novo" : "Escrever roteiro") : null),
      !v ? h("div.suave", {}, "O roteiro é escrito a partir do plano.") : !r ? h("div.suave", {}, "Opcional. O roteiro só usa fatos do projeto e do material: nada é inventado.") : [
        r.avisos.map((a) => h("div.nota", {}, a)),
        h("table", {}, h("thead", {}, h("tr", {}, ["Parte", "Tipo", "Texto"].map((c) => h("th", {}, c)))),
          h("tbody", {}, r.linhas.map((l) => h("tr", {}, h("td", {}, BLOCOS[l.bloco] ?? l.bloco), h("td", {}, TIPOS_DE_LINHA[l.tipo] ?? l.tipo), h("td", {}, l.texto))))),
        h("small", {}, r.base === "modelo" ? "Escrito por modelo de linguagem e conferido contra os fatos." : "Estrutura montada sem modelo de linguagem, com os fatos do material."),
      ]));

    if (d.historico.length > 1) por(area, h("section.bloco", {}, h("h2", {}, "Versões do plano"), h("table", {},
      h("thead", {}, h("tr", {}, ["Versão", "Situação", "Autor", "Nota", "Data"].map((c) => h("th", {}, c)))),
      h("tbody", {}, d.historico.map((x) => h("tr", {}, h("td", {}, `v${x.versao}`), h("td", {}, etiqueta(...ESTADOS[x.estado])), h("td", {}, x.autor === "ia" ? "Aplicação" : "Você"), h("td", {}, x.nota), h("td", {}, quando(x.criadoEm))))))));
  }

  por(raiz, area);
  desenhar(await api(`/api/projetos/${id}/plano`));
  return {
    aoEvento: (nome, dados) => {
      // O plano pode ser gerado automaticamente ao fim da análise.
      if (nome === "tarefa:atualizada" && dados.tipo === "analise-de-brutos" && dados.estado === "concluida") api(`/api/projetos/${id}/plano`).then(desenhar).catch(() => undefined);
    },
  };
}
