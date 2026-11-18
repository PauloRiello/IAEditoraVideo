// Formulário de configuração de um projeto, usado ao criar e ao alterar.

import { campo, escolha, h } from "/nucleo.js";

const RESOLUCOES = [[720, "HD (720p)"], [1080, "Full HD (1080p)"], [1440, "2K (1440p)"], [2160, "4K (2160p)"]];
const PROPORCOES = [["vertical", "Vertical 9:16 (Reels, TikTok, Shorts)"], ["horizontal", "Horizontal 16:9 (YouTube, TV)"], ["quadrado", "Quadrado 1:1 (feed)"], ["personalizada", "Personalizada"]];
const NIVEIS = [
  ["sugestao", "Sugestão — a aplicação só faz o que eu pedir, passo a passo"],
  ["assistido", "Assistido — gera o plano após a análise e monta a timeline após a aprovação"],
  ["automatico", "Automático — além disso, gera a prévia sozinha"],
];
const PLATAFORMAS = ["Instagram Reels", "TikTok", "YouTube", "YouTube Shorts", "Anúncio", "Site", "Apresentação", "Televisão"];

function medidas(proporcao, lado) {
  const maior = Math.round((lado * 16) / 9 / 2) * 2;
  return proporcao === "vertical" ? [lado, maior] : proporcao === "horizontal" ? [maior, lado] : [lado, lado];
}

function lerFormato(largura, altura) {
  const lado = Math.min(largura, altura);
  const proporcao = largura === altura ? "quadrado" : Math.abs(largura / altura - 9 / 16) < 0.01 ? "vertical" : Math.abs(largura / altura - 16 / 9) < 0.01 ? "horizontal" : "personalizada";
  return RESOLUCOES.some(([r]) => r === lado) && proporcao !== "personalizada" ? { proporcao, lado } : { proporcao: "personalizada", lado: 1080 };
}

/** Devolve { no, valores() }. `projeto` ausente: formulário de projeto novo. */
export function formularioDoProjeto(catalogo, projeto) {
  const c = projeto?.configuracao ?? {};
  const perfilInicial = projeto?.perfil ?? catalogo.perfilPadrao;
  const formatoDoPerfil = (id) => {
    const perfil = catalogo.perfis.find((p) => p.id === id) ?? catalogo.perfis[0];
    return perfil.formatos.find((f) => f.id === perfil.formatoPadrao) ?? perfil.formatos[0];
  };
  const inicial = projeto?.formatoEfetivo ?? formatoDoPerfil(perfilInicial);
  const lido = lerFormato(inicial.largura, inicial.altura);

  const nome = h("input", { value: projeto?.nome ?? "", placeholder: "Por exemplo: Inauguração da Cidade Alta", required: true });
  const descricaoDoPerfil = h("div.ajuda");
  const perfil = escolha(catalogo.perfis.map((p) => [p.id, p.nome]), perfilInicial);
  const objetivo = h("textarea", { value: c.objetivo ?? "", placeholder: "O que este vídeo precisa conseguir? Por exemplo: divulgar a inauguração do servidor no dia 20." });
  const publico = h("input", { value: c.publico ?? "", placeholder: "Quem vai assistir" });
  const plataforma = h("input", { value: c.plataforma ?? "", placeholder: "Onde será publicado", list: "plataformas" });
  const proporcao = escolha(PROPORCOES, lido.proporcao);
  const resolucao = escolha(RESOLUCOES, lido.lado);
  const largura = h("input", { type: "number", min: 160, max: 7680, step: 2, value: inicial.largura });
  const altura = h("input", { type: "number", min: 160, max: 7680, step: 2, value: inicial.altura });
  const fps = escolha([[24, "24 (cinema)"], [25, "25"], [30, "30 (padrão)"], [50, "50"], [60, "60 (jogos, movimento rápido)"]], c.fps ?? inicial.fps);
  const duracao = h("input", { type: "number", min: 1, max: 14400, value: c.duracaoSeg ?? "", placeholder: "Em segundos" });
  const intervencao = escolha(NIVEIS, c.intervencao ?? "assistido");
  const cta = h("input", { value: c.cta ?? "", placeholder: "Por exemplo: Entre no nosso Discord" });
  const fatos = h("textarea", { value: (c.fatos ?? []).join("\n"), placeholder: "Um por linha. Por exemplo: O servidor abre no dia 20." });
  const marca = escolha([["", "Nenhuma"], ...(catalogo.marcas ?? []).map((m) => [m.id, m.nome])], c.marca ?? "");
  const estilos = catalogo.estilos.map((e) => h("label.marca-campo", { title: e.descricao }, h("input", { type: "checkbox", value: e.id, checked: (c.estilos ?? []).includes(e.id) }), e.nome));

  const campoResolucao = campo("Resolução", resolucao);
  const campoLargura = campo("Largura (pixels)", largura);
  const campoAltura = campo("Altura (pixels)", altura);
  const atualizar = () => {
    const personalizada = proporcao.value === "personalizada";
    campoResolucao.hidden = personalizada;
    campoLargura.hidden = campoAltura.hidden = !personalizada;
    if (!personalizada) [largura.value, altura.value] = medidas(proporcao.value, Number(resolucao.value));
    descricaoDoPerfil.textContent = catalogo.perfis.find((p) => p.id === perfil.value)?.descricao ?? "";
  };
  proporcao.addEventListener("change", atualizar);
  resolucao.addEventListener("change", atualizar);
  perfil.addEventListener("change", () => {
    if (!projeto) {
      const f = formatoDoPerfil(perfil.value), novo = lerFormato(f.largura, f.altura);
      proporcao.value = novo.proporcao; resolucao.value = novo.lado; largura.value = f.largura; altura.value = f.altura; fps.value = f.fps;
    }
    atualizar();
  });
  atualizar();

  const no = h("div.formulario", {},
    h("div.larga", {}, campo("Nome do projeto", nome)),
    campo("Segmento (perfil de especialização)", perfil, descricaoDoPerfil),
    campo("Nível de intervenção automática", intervencao, "O plano sempre espera a sua aprovação, e a exportação final é sempre pedida por você."),
    h("div.larga", {}, campo("Objetivo do vídeo", objetivo, "Necessário para gerar o plano de edição.")),
    campo("Público", publico), campo("Plataforma", plataforma),
    campo("Proporção", proporcao), campoResolucao, campoLargura, campoAltura,
    campo("Quadros por segundo (FPS)", fps), campo("Duração desejada", duracao, "Vazio: a aplicação decide pelo material e pelo formato."),
    h("div.larga", {}, h("div.campo", { style: "font-size:12.5px;color:var(--suave)" }, "Estilos de edição"), h("div.linha", { style: "gap:6px 16px;margin-top:6px" }, estilos),
      h("div.ajuda", {}, "Nenhum marcado: estilo padrão. Mais de um: combinados.")),
    campo("Marca (identidade visual)", marca, "Logo, cores e fontes aplicados no vídeo. Só aparecem as marcas prontas (menu Marcas)."),
    h("div.larga", {}, campo("Chamada para ação (CTA)", cta, "Vazio: o vídeo não terá chamada para ação. Nada é inventado.")),
    h("div.larga", {}, campo("Fatos que podem aparecer no vídeo", fatos, "Só o que estiver aqui ou no próprio material entra em textos e no roteiro.")),
    h("datalist", { id: "plataformas" }, PLATAFORMAS.map((p) => h("option", { value: p }))),
  );

  return {
    no, foco: () => nome.focus(),
    valores: () => ({
      nome: nome.value, perfil: perfil.value,
      configuracao: {
        objetivo: objetivo.value, publico: publico.value, plataforma: plataforma.value, cta: cta.value, fatos: fatos.value.split("\n").map((f) => f.trim()).filter(Boolean),
        largura: Number(largura.value) || null, altura: Number(altura.value) || null, fps: Number(fps.value) || null, duracaoSeg: duracao.value === "" ? null : Number(duracao.value),
        estilos: estilos.map((e) => e.firstChild).filter((caixa) => caixa.checked).map((caixa) => caixa.value), intervencao: intervencao.value, marca: marca.value,
      },
    }),
  };
}

export const ETAPAS = [["material", "Material"], ["analise", "Análise"], ["plano", "Plano"], ["aprovacao", "Aprovação"], ["edicao", "Montagem"], ["previa", "Prévia"], ["exportacao", "Exportação"], ["concluido", "Concluído"]];

export function etapasDoProjeto(etapa) {
  const atual = ETAPAS.findIndex(([id]) => id === etapa);
  return h("ol.etapas", {}, ETAPAS.map(([id, nome], i) => h(`li${i < atual || etapa === "concluido" ? ".feita" : i === atual ? ".atual" : ""}`, { dados: { etapa: id } }, nome)));
}

export const rotuloDaEtapa = (etapa) => ({
  material: "Aguardando material", analise: "Aguardando análise", plano: "Aguardando plano", aprovacao: "Plano aguardando aprovação", edicao: "Pronto para montar",
  previa: "Aguardando prévia", exportacao: "Pronto para exportar", concluido: "Exportado",
}[etapa] ?? etapa);
