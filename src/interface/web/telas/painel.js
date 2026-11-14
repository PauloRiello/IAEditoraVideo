// Painel inicial: criar e abrir projetos, recentes, processamento em andamento e histórico de atividades.

import { api, etiqueta, h, limpar, linhaDeTarefa, quando } from "/nucleo.js";
import { rotuloDaEtapa } from "/telas/formulario-projeto.js";
import { abrirNovoProjeto } from "/telas/projetos.js";

export function cartaoDoProjeto(p) {
  const r = p.resumo;
  return h("a.cartao", { href: `#/projeto/${p.id}` },
    h("div.linha", {}, h("h3", {}, p.nome), h("span.espaco"), etiqueta(rotuloDaEtapa(r.etapa), r.etapa === "concluido" ? "bom" : "destaque")),
    h("div.suave", {}, `${p.perfilNome}${p.formatoEfetivo ? ` · ${p.formatoEfetivo.largura}×${p.formatoEfetivo.altura}, ${p.formatoEfetivo.fps} fps` : ""}`),
    h("div.numeros", {}, h("span", {}, h("b", {}, r.brutos), " vídeo(s)"), h("span", {}, h("b", {}, r.referencias), " referência(s)"), h("span", {}, h("b", {}, r.exportacoes), " exportação(ões)")),
    h("small", {}, `Atualizado em ${quando(p.atualizadoEm)}`),
  );
}

export async function mostrar(raiz, contexto) {
  const projetos = h("div"), tarefas = h("div"), atividades = h("div"), avisos = h("div");

  const desenhar = (painel) => {
    limpar(avisos).append(painel.avisos.map((a) => h("div.nota.alerta", {}, a)));
    limpar(projetos).append(painel.projetos.length
      ? h("div.grade.cartoes", {}, painel.projetos.map(cartaoDoProjeto))
      : h("div.vazio", {}, "Nenhum projeto ainda. Crie o primeiro para começar."));
    const lista = painel.tarefas.slice(0, 8);
    limpar(tarefas).append(lista.length ? h("ul.lista", {}, lista.map(linhaDeTarefa)) : h("div.vazio", {}, "Nada em processamento."));
    limpar(atividades).append(painel.atividades.length
      ? h("ul.lista", {}, painel.atividades.map((a) => h("li", {}, h("time", {}, quando(a.criadoEm)),
        h("span", {}, a.projetoNome ? [h("a", { href: `#/projeto/${a.projetoId}` }, a.projetoNome), " — "] : null, a.descricao))))
      : h("div.vazio", {}, "As atividades aparecem aqui conforme você usa a aplicação."));
  };
  const carregar = async () => desenhar(await api("/api/painel"));

  raiz.append(
    h("div.cabecalho", {},
      h("div", {}, h("h1", {}, "Painel"), h("div.subtitulo", {}, "Seus projetos, o que está sendo processado e o que aconteceu por último.")),
      h("div.acoes", {}, h("a.botao", { href: "#/projetos" }, "Abrir projeto"), h("button.principal", { aoClicar: () => abrirNovoProjeto(contexto) }, "Criar projeto"))),
    avisos,
    h("section.bloco", {}, h("h2", {}, "Projetos recentes", h("a", { href: "#/projetos", style: "font-size:13px;font-weight:400" }, "Ver todos")), projetos),
    h("div.grade.duas", {},
      h("section.bloco", {}, h("h2", {}, "Status do processamento"), tarefas),
      h("section.bloco", {}, h("h2", {}, "Histórico de atividades"), atividades)),
  );
  await carregar();

  let pendente = null;
  return {
    aoEvento: (nome) => {
      if (nome === "render:progresso") return;
      clearTimeout(pendente);
      pendente = setTimeout(() => carregar().catch(() => undefined), 300);
    },
    aoSair: () => clearTimeout(pendente),
  };
}
