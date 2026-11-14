// Lista de projetos e criação de projeto novo.

import { agir, api, dialogo, h, limpar } from "/nucleo.js";
import { formularioDoProjeto } from "/telas/formulario-projeto.js";
import { cartaoDoProjeto } from "/telas/painel.js";

export function abrirNovoProjeto(contexto) {
  const formulario = formularioDoProjeto(contexto.catalogo);
  const criar = (evento) => agir(evento, async () => {
    const projeto = await api("/api/projetos", { metodo: "POST", corpo: formulario.valores() });
    caixa.fechar();
    contexto.ir(`#/projeto/${projeto.id}/material`);
  });
  const caixa = dialogo({
    titulo: "Criar projeto", corpo: formulario.no,
    acoes: [h("button", { aoClicar: () => caixa.fechar() }, "Cancelar"), h("button.principal", { aoClicar: criar }, "Criar projeto")],
  });
  formulario.foco();
}

export async function mostrar(raiz, contexto) {
  const todos = await api("/api/projetos");
  const lista = h("div");
  const busca = h("input", { type: "search", placeholder: "Procurar por nome ou segmento", style: "max-width:320px" });
  const desenhar = () => {
    const termo = busca.value.trim().toLowerCase();
    const visiveis = todos.filter((p) => !termo || `${p.nome} ${p.perfilNome}`.toLowerCase().includes(termo));
    limpar(lista).append(visiveis.length
      ? h("div.grade.cartoes", {}, visiveis.map(cartaoDoProjeto))
      : h("div.vazio", {}, todos.length ? "Nenhum projeto com esse nome." : "Nenhum projeto ainda. Crie o primeiro para começar."));
  };
  busca.addEventListener("input", desenhar);
  raiz.append(
    h("div.cabecalho", {},
      h("div", {}, h("h1", {}, "Projetos"), h("div.subtitulo", {}, `${todos.length} projeto(s). Clique em um para abrir.`)),
      h("div.acoes", {}, busca, h("button.principal", { aoClicar: () => abrirNovoProjeto(contexto) }, "Criar projeto"))),
    lista,
  );
  desenhar();
}
