// Tela de um projeto: cabeçalho com as etapas e abas de trabalho.

import { agir, api, confirmar, h, limpar, quando, por } from "/nucleo.js";
import { etapasDoProjeto, formularioDoProjeto } from "/telas/formulario-projeto.js";

const ABAS = [["visao", "Visão geral"], ["material", "Material e análise"], ["plano", "Plano e roteiro"], ["edicao", "Edição"], ["exportacao", "Exportação"], ["avaliacao", "Avaliação"]];
const MODULOS = {
  material: () => import("/telas/projeto-material.js"), plano: () => import("/telas/projeto-plano.js"), edicao: () => import("/telas/projeto-edicao.js"),
  exportacao: () => import("/telas/projeto-exportacao.js"), avaliacao: () => import("/telas/projeto-avaliacao.js"),
};
const PROXIMO = {
  material: ["Adicione os vídeos brutos do projeto.", "material", "Adicionar vídeos"],
  analise: ["Analise os vídeos brutos para a aplicação conhecer o material.", "material", "Ir para a análise"],
  plano: ["Gere o plano de edição a partir do objetivo e do material analisado.", "plano", "Ir para o plano"],
  aprovacao: ["Revise o plano de edição e aprove para a edição começar.", "plano", "Revisar o plano"],
  edicao: ["O plano está aprovado. Monte a timeline.", "edicao", "Ir para a edição"],
  previa: ["A timeline está pronta. Gere uma prévia para assistir.", "edicao", "Ir para a edição"],
  exportacao: ["Assistiu à prévia? Exporte o vídeo final.", "exportacao", "Ir para a exportação"],
  concluido: ["O vídeo foi exportado. Avalie a edição para a aplicação aprender com o resultado.", "avaliacao", "Avaliar a edição"],
};

async function visaoGeral(raiz, estado) {
  const { projeto, contexto } = estado;
  const formulario = formularioDoProjeto(contexto.catalogo, projeto);
  const atividades = await api(`/api/projetos/${projeto.id}/atividades`);
  const [texto, aba, rotulo] = PROXIMO[projeto.resumo.etapa] ?? PROXIMO.material;
  const salvar = (evento) => agir(evento, async () => {
    await api(`/api/projetos/${projeto.id}`, { metodo: "PUT", corpo: formulario.valores() });
    await estado.recarregarProjeto();
  }, "Configuração salva.");
  const remover = async (evento) => {
    const sim = await confirmar("Remover este projeto?", `"${projeto.nome}" sai da aplicação com o plano, a timeline e o histórico. Os vídeos brutos e os arquivos exportados continuam nas pastas.`, { rotulo: "Remover projeto", perigo: true });
    if (sim) await agir(evento.target, async () => { await api(`/api/projetos/${projeto.id}`, { metodo: "DELETE" }); contexto.ir("#/projetos"); });
  };
  por(raiz, 
    h("div.nota.bom", {}, h("div.linha", {}, h("span", {}, h("strong", {}, "Próximo passo: "), texto), h("span.espaco"), h("a.botao", { href: `#/projeto/${projeto.id}/${aba}` }, rotulo))),
    h("section.bloco", {}, h("h2", {}, "Configuração do projeto"), formulario.no,
      h("div.linha", { style: "margin-top:16px" }, h("button.principal", { aoClicar: salvar }, "Salvar configuração"),
        h("small", {}, "Mudanças de formato, duração e estilo valem para o próximo plano gerado."))),
    h("div.grade.duas", {},
      h("section.bloco", {}, h("h2", {}, "Histórico do projeto"), atividades.length
        ? h("ul.lista", {}, atividades.map((a) => h("li", {}, h("time", {}, quando(a.criadoEm)), h("span", {}, a.descricao))))
        : h("div.vazio", {}, "Nada aconteceu ainda neste projeto.")),
      h("section.bloco", {}, h("h2", {}, "Pastas e remoção"),
        h("dl.chaves", {}, h("dt", {}, "Vídeos brutos"), h("dd", {}, projeto.pastaDeBrutos), h("dt", {}, "Criado em"), h("dd", {}, quando(projeto.criadoEm))),
        h("div.linha", { style: "margin-top:14px" },
          h("button", { aoClicar: (e) => agir(e, () => api("/api/abrir", { metodo: "POST", corpo: { alvo: "brutos", projetoId: projeto.id } })) }, "Abrir pasta de vídeos"),
          h("button", { aoClicar: (e) => agir(e, () => api("/api/abrir", { metodo: "POST", corpo: { alvo: "exportacoes", projetoId: projeto.id } })) }, "Abrir pasta de exportações"),
          h("span.espaco"), h("button.perigo", { aoClicar: remover }, "Remover projeto")))),
  );
  return {};
}

export async function mostrar(raiz, contexto, partes) {
  const id = partes[0];
  let projeto = await api(`/api/projetos/${id}`);
  const cabecalho = h("div"), abas = h("nav.abas"), corpo = h("div");
  let abaAtual = null, nomeDaAba = "", vez = 0, pendente = null;

  const desenharCabecalho = () => {
    const f = projeto.formatoEfetivo;
    por(limpar(cabecalho), h("div.cabecalho", { style: "margin-bottom:0" }, h("div", {},
      h("div.suave", {}, h("a", { href: "#/projetos" }, "Projetos"), " / ", projeto.perfilNome),
      h("h1", {}, projeto.nome),
      h("div.subtitulo", {}, [f ? `${f.largura}×${f.altura}, ${f.fps} fps` : null, projeto.configuracao.plataforma || null, projeto.configuracao.duracaoSeg ? `${projeto.configuracao.duracaoSeg} s` : null].filter(Boolean).join(" · ")),
      etapasDoProjeto(projeto.resumo.etapa))));
  };
  const estado = {
    contexto, get projeto() { return projeto; },
    recarregarProjeto: async () => { projeto = await api(`/api/projetos/${id}`); desenharCabecalho(); return projeto; },
    irParaAba: (nome) => contexto.ir(`#/projeto/${id}/${nome}`),
  };

  const abrirAba = async (pedido) => {
    const nome = ABAS.some(([a]) => a === pedido) ? pedido : "visao";
    const minhaVez = (vez += 1);
    por(limpar(abas), ABAS.map(([a, rotulo]) => h(`a${a === nome ? ".ativo" : ""}`, { href: `#/projeto/${id}/${a}` }, rotulo)));
    abaAtual?.aoSair?.();
    abaAtual = null;
    nomeDaAba = nome;
    const area = h("div");
    try {
      await estado.recarregarProjeto();
      const tela = nome === "visao" ? await visaoGeral(area, estado) : await (await MODULOS[nome]()).aba(area, estado);
      if (minhaVez !== vez) return;
      abaAtual = tela ?? {};
    } catch (erro) {
      if (minhaVez !== vez) return;
      por(limpar(area), h("div.nota.erro", {}, erro.message));
    }
    por(limpar(corpo), area);
  };

  por(raiz, cabecalho, abas, corpo);
  desenharCabecalho();
  await abrirAba(partes[1]);

  return {
    aoNavegar: async (novas) => {
      if (novas[0] !== id) return false;
      await abrirAba(novas[1]);
      return true;
    },
    aoEvento: (nome, dados) => {
      if (dados?.projetoId && dados.projetoId !== id) return;
      abaAtual?.aoEvento?.(nome, dados);
      if (nome === "atividade") {
        clearTimeout(pendente);
        pendente = setTimeout(() => {
          estado.recarregarProjeto().catch(() => undefined);
          if (nomeDaAba === "visao") abrirAba("visao");
        }, 400);
      }
    },
    aoSair: () => { clearTimeout(pendente); abaAtual?.aoSair?.(); },
  };
}
