// Configurações: preferências gerais, transcrição, provedores de IA (todos opcionais), computador, pastas e cópias de segurança.

import { agir, api, aviso, barra, campo, confirmar, dialogo, escolha, etiqueta, h, limpar, quando, por } from "/nucleo.js";

const MOTIVOS = { manual: "Manual", automatica: "Automática", "pre-migracao": "Antes de atualizar o banco", "pre-restauracao": "Antes de uma restauração", "pre-atualizacao": "Antes de atualizar o programa" };

export async function mostrar(raiz, contexto) {
  const { catalogo } = contexto;
  const area = h("div");
  let c = null, copias = [], local = null, instalando = null;

  const salvar = (corpo, sucesso = "Configuração salva.") => (evento) => agir(evento, async () => { c = await api("/api/configuracoes", { metodo: "PUT", corpo }); desenhar(); }, sucesso);

  function editarProvedor(p, localDetectado) {
    const novo = !p;
    const base = p ?? { id: "", nome: localDetectado?.nome ?? "", origem: localDetectado ? "local" : "externo", urlBase: localDetectado?.urlBase ?? "", modelo: localDetectado?.modelos[0] ?? "", capacidades: ["texto"], ativo: true };
    const nome = h("input", { value: base.nome, placeholder: "Nome para reconhecer este provedor" });
    const origem = escolha([["local", "Local — roda neste computador"], ["externo", "Externo — serviço de terceiros pela internet"]], base.origem);
    const url = h("input", { value: base.urlBase, placeholder: "https://…/v1  (endereço compatível com a API OpenAI)" });
    const modelo = localDetectado?.modelos.length ? escolha(localDetectado.modelos, base.modelo) : h("input", { value: base.modelo, placeholder: "Nome do modelo" });
    const texto = h("input", { type: "checkbox", checked: base.capacidades.includes("texto") });
    const visao = h("input", { type: "checkbox", checked: base.capacidades.includes("visao") });
    const ativo = h("input", { type: "checkbox", checked: base.ativo });
    const chave = h("input", { type: "password", autocomplete: "off", placeholder: p?.temChave ? "Chave guardada. Deixe vazio para manter." : "Cole a chave de API" });
    const campoChave = campo("Chave de API", chave, "Fica guardada só neste computador, em arquivo separado das configurações. Nunca é mostrada de volta nem entra nas cópias de segurança.");
    const atualizar = () => { campoChave.hidden = origem.value !== "externo"; };
    origem.addEventListener("change", atualizar);
    atualizar();
    const gravar = (evento) => agir(evento, async () => {
      const id = p?.id ?? (nome.value || "provedor").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
      c = await api("/api/ia/provedores", { metodo: "POST", corpo: {
        id, nome: nome.value, origem: origem.value, urlBase: url.value, modelo: modelo.value, capacidades: [texto.checked ? "texto" : null, visao.checked ? "visao" : null].filter(Boolean), ativo: ativo.checked,
        ...(origem.value === "externo" && chave.value ? { chave: chave.value } : {}),
      } });
      caixa.fechar();
      desenhar();
    }, "Provedor salvo.");
    const caixa = dialogo({
      titulo: novo ? "Adicionar provedor de IA" : `Provedor: ${p.nome}`, estreito: true,
      corpo: h("div", { style: "display:grid;gap:12px" }, campo("Nome", nome), campo("Onde roda", origem), campo("Endereço", url), campo("Modelo", modelo),
        h("div.linha", {}, h("label.marca-campo", {}, texto, "Entende texto"), h("label.marca-campo", {}, visao, "Entende imagens"), h("label.marca-campo", {}, ativo, "Ativo")), campoChave),
      acoes: [h("button", { aoClicar: () => caixa.fechar() }, "Cancelar"), h("button.principal", { aoClicar: gravar }, "Salvar")],
    });
  }

  const procurarLocais = (evento) => agir(evento, async () => {
    const achados = await api("/api/ia/locais");
    if (achados.length === 0) return aviso("Nenhum servidor de modelos local encontrado (Ollama, LM Studio ou llama.cpp). A aplicação continua funcionando sem ele.");
    if (achados.length === 1) return editarProvedor(null, achados[0]);
    const caixa = dialogo({ titulo: "Servidores locais encontrados", estreito: true, corpo: h("ul.lista", {}, achados.map((s) => h("li", {}, h("span", { style: "flex:1" }, h("strong", {}, s.nome), ` — ${s.modelos.length} modelo(s)`),
      h("button.pequeno", { aoClicar: () => { caixa.fechar(); editarProvedor(null, s); } }, "Usar")))) });
    return undefined;
  });

  function ia() {
    const estadoDe = (p) => !p.ativo ? etiqueta("Desativado") : p.origem === "externo" && !c.ia.permitirExternos ? etiqueta("Bloqueado: externos não autorizados", "alerta")
      : p.origem === "externo" && !p.temChave ? etiqueta("Sem chave", "alerta") : p.estado?.disponivel ? etiqueta("Conectado", "bom") : etiqueta("Sem conexão", "ruim");
    return h("section.bloco", {}, h("h2", {}, "Inteligência artificial"),
      h("div.nota.bom", {}, "A aplicação funciona inteira sem nenhum provedor de IA e sem internet. Provedores são opcionais e só acrescentam as leituras marcadas abaixo como dependentes de modelo."),
      h("h3", {}, "O que funciona neste computador e o que depende de um modelo"),
      h("div.rolavel", {}, h("table", {}, h("thead", {}, h("tr", {}, ["Recurso", "Funciona sem provedor", "Uso de modelo"].map((x) => h("th", {}, x)))),
        h("tbody", {}, c.recursos.map((r) => h("tr", {}, h("td", {}, r.recurso), h("td", {}, r.local ? etiqueta("Sim, local", "bom") : etiqueta("Fica como não avaliado", "alerta")), h("td.suave", {}, r.modelo)))))),
      h("h3", { style: "margin-top:18px" }, "Uso de provedores"),
      h("div", { style: "display:grid;gap:8px" },
        h("label.marca-campo", {}, h("input", { type: "checkbox", checked: c.ia.permitirExternos, aoMudar: (e) => agir(e, async () => { c = await api("/api/ia/politica", { metodo: "PUT", corpo: { permitirExternos: e.target.checked } }); desenhar(); }) }),
          h("span", {}, "Permitir provedores externos ", h("small", {}, "— envia trechos de transcrição e quadros dos vídeos a um serviço de terceiros. Desligado por padrão."))),
        h("label.marca-campo", {}, h("input", { type: "checkbox", checked: c.ia.preferirLocal, aoMudar: (e) => agir(e, async () => { c = await api("/api/ia/politica", { metodo: "PUT", corpo: { preferirLocal: e.target.checked } }); desenhar(); }) }),
          "Preferir modelos locais quando houver os dois")),
      h("h3", { style: "margin-top:18px" }, "Provedores configurados"),
      c.provedores.length === 0 ? h("div.vazio", {}, "Nenhum provedor configurado. Nada precisa ser feito para usar a aplicação.") : h("table", {},
        h("thead", {}, h("tr", {}, ["Provedor", "Onde roda", "Modelo ativo", "Entende", "Estado da conexão", ""].map((x) => h("th", {}, x)))),
        h("tbody", {}, c.provedores.map((p) => h("tr", {}, h("td", {}, h("strong", {}, p.nome)), h("td", {}, p.origem === "local" ? "Neste computador" : "Serviço externo"), h("td", {}, p.modelo),
          h("td", {}, p.capacidades.map((x) => ({ texto: "texto", visao: "imagens" }[x] ?? x)).join(", ")), h("td", {}, estadoDe(p)),
          h("td", { style: "text-align:right;white-space:nowrap" }, h("button.pequeno", { aoClicar: () => editarProvedor(p) }, "Alterar"), " ",
            h("button.pequeno.perigo", { aoClicar: async (e) => {
              if (await confirmar("Remover este provedor?", `"${p.nome}" e a chave guardada dele serão removidos.`, { rotulo: "Remover", perigo: true })) await agir(e.target, async () => { c = await api(`/api/ia/provedores/${p.id}`, { metodo: "DELETE" }); desenhar(); }, "Provedor removido.");
            } }, "Remover")))))),
      h("div.linha", { style: "margin-top:12px" }, h("button", { aoClicar: procurarLocais }, "Procurar modelos locais"), h("button", { aoClicar: () => editarProvedor(null) }, "Adicionar provedor"),
        h("button.discreto", { aoClicar: (e) => agir(e, carregar, "Estado das conexões atualizado.") }, "Testar conexões")));
  }

  function geral() {
    const perfil = escolha(catalogo.perfis.map((p) => [p.id, p.nome]), c.perfilPadrao);
    const modelo = escolha(c.transcricaoLocal.modelos.map((m) => [m, `${m}${c.transcricaoLocal.baixados.includes(m) ? " (já baixado)" : ""}`]), c.transcricao.modelo);
    const idioma = h("input", { value: c.transcricao.idioma, placeholder: "Vazio: detectar. Exemplo: pt", maxLength: 5 });
    return h("section.bloco", {}, h("h2", {}, "Preferências gerais e modelos locais"),
      h("div.formulario", {}, campo("Segmento sugerido em projetos novos", perfil),
        campo("Modelo local de transcrição (Whisper)", modelo, "Modelos maiores são mais precisos e mais lentos. O modelo é baixado uma vez, no primeiro uso, e depois funciona sem internet."),
        campo("Idioma das falas", idioma)),
      h("button.principal", { style: "margin-top:14px", aoClicar: (e) => salvar({ perfilPadrao: perfil.value, transcricao: { modelo: modelo.value, idioma: idioma.value } })(e) }, "Salvar preferências"));
  }

  function computador() {
    const hw = c.hardware;
    const abrir = (alvo) => (e) => agir(e, () => api("/api/abrir", { metodo: "POST", corpo: { alvo } }));
    return h("div.grade.duas", {},
      h("section.bloco", {}, h("h2", {}, "Recursos deste computador"), h("dl.chaves", {},
        h("dt", {}, "Sistema"), h("dd", {}, hw.plataforma), h("dt", {}, "Processador"), h("dd", {}, `${hw.nucleos} núcleo(s)`), h("dt", {}, "Memória"), h("dd", {}, `${Math.round(hw.memoriaTotalMB / 1024)} GB`),
        h("dt", {}, "Placa de vídeo"), h("dd", {}, hw.gpu ? `${hw.gpu.nome}${hw.gpu.vramMB ? ` (${Math.round(hw.gpu.vramMB / 1024)} GB)` : ""}` : "Nenhuma detectada: tudo roda pelo processador"),
        h("dt", {}, "Codificação acelerada"), h("dd", {}, hw.codificacaoPorHardware ? "Disponível" : "Não disponível: a codificação usa o processador"))),
      h("section.bloco", {}, h("h2", {}, "Pastas"), h("dl.chaves", {},
        h("dt", {}, "Vídeos brutos"), h("dd", {}, c.pastas.brutos), h("dt", {}, "Referências"), h("dd", {}, c.pastas.referencias), h("dt", {}, "Exportações"), h("dd", {}, c.pastas.exportacoes),
        h("dt", {}, "Dados da aplicação"), h("dd", {}, c.pastas.dados), h("dt", {}, "Programa"), h("dd", {}, c.pastas.programa)),
        h("div.linha", { style: "margin-top:12px" }, h("button.pequeno", { aoClicar: abrir("brutos") }, "Abrir vídeos brutos"), h("button.pequeno", { aoClicar: abrir("exportacoes") }, "Abrir exportações"), h("button.pequeno", { aoClicar: abrir("dados") }, "Abrir dados")),
        h("p.suave", { style: "margin-top:10px" }, "Os dados e os vídeos ficam separados do programa: atualizar a aplicação não apaga projetos, aprendizados nem exportações.")));
  }

  function seguranca() {
    const automatico = h("input", { type: "checkbox", checked: c.backup.automatico });
    const intervalo = h("input", { type: "number", min: 1, value: c.backup.intervaloHoras });
    const manter = h("input", { type: "number", min: 1, value: c.backup.manter });
    const restaurar = (copia) => async (e) => {
      if (await confirmar("Restaurar esta cópia?", `Projetos, aprendizados e configurações voltam ao estado de ${quando(copia.criadaEm)}. O estado atual é guardado antes em outra cópia, para você poder voltar. Os vídeos não são alterados.`, { rotulo: "Restaurar" })) {
        await agir(e.target, async () => { await api("/api/backups/restaurar", { metodo: "POST", corpo: { nome: copia.nome } }); contexto.catalogo = await api("/api/catalogo"); await carregar(); }, "Cópia restaurada.");
      }
    };
    return h("section.bloco", {}, h("h2", {}, "Cópias de segurança", h("span.acoes", {},
      h("button.pequeno", { aoClicar: (e) => agir(e, () => api("/api/abrir", { metodo: "POST", corpo: { alvo: "backups" } })) }, "Abrir pasta"),
      h("button.pequeno.principal", { aoClicar: (e) => agir(e, async () => { copias = await api("/api/backups", { metodo: "POST" }); desenhar(); }, "Cópia de segurança criada.") }, "Criar cópia agora"))),
      h("p.suave", {}, "Cada cópia guarda o banco (projetos, planos, timelines, aprendizados), as configurações e os perfis personalizados. Os vídeos não entram: copie as pastas de vídeos e exportações por conta própria. As chaves de API também não entram."),
      h("div.formulario", {}, h("label.marca-campo", {}, automatico, "Criar cópias automaticamente ao abrir"), campo("Intervalo mínimo (horas)", intervalo), campo("Cópias automáticas mantidas", manter)),
      h("button", { style: "margin:12px 0", aoClicar: (e) => salvar({ backup: { automatico: automatico.checked, intervaloHoras: intervalo.value, manter: manter.value } })(e) }, "Salvar opções de cópia"),
      copias.length === 0 ? h("div.vazio", {}, "Nenhuma cópia de segurança ainda.") : h("table", {}, h("thead", {}, h("tr", {}, ["Data", "Motivo", ""].map((x) => h("th", {}, x)))),
        h("tbody", {}, copias.slice(0, 15).map((copia) => h("tr", {}, h("td", {}, quando(copia.criadaEm)), h("td", {}, MOTIVOS[copia.motivo] ?? copia.motivo),
          h("td", { style: "text-align:right" }, h("button.pequeno", { aoClicar: restaurar(copia) }, "Restaurar")))))));
  }

  function iaLocal() {
    const gb = (mb) => `${(mb / 1024).toFixed(1)} GB`;
    const modelo = escolha(local.modelos.map((m) => [m.id, `${m.nome} — ${gb(m.tamanhoMB)}${m.id === local.recomendado ? " (recomendado para este computador)" : m.adequado ? "" : " (pesado para este computador)"}`]), local.modelo?.id ?? local.recomendado);
    const descricao = h("div.ajuda");
    const atualizar = () => {
      const m = local.modelos.find((x) => x.id === modelo.value);
      limpar(descricao).append(`${m.descricao} Licença ${m.licenca}. `, h("a", { href: m.origem, target: "_blank", rel: "noopener" }, "Origem do modelo"));
    };
    modelo.addEventListener("change", atualizar);
    atualizar();
    const instalar = (e) => agir(e, async () => {
      instalando = await api("/api/ia/local/instalar", { metodo: "POST", corpo: { modelo: modelo.value } });
      desenhar();
    }, "Instalação iniciada. Pode continuar usando a aplicação.");
    const remover = async (e) => {
      if (await confirmar("Remover a IA local?", "O motor e o modelo são apagados deste computador. As interpretações já feitas continuam nos projetos. Para usar de novo, será preciso baixar outra vez.", { rotulo: "Remover", perigo: true })) {
        await agir(e.target, async () => { local = await api("/api/ia/local", { metodo: "DELETE" }); desenhar(); }, "IA local removida.");
      }
    };
    const situacao = !local.instalada ? etiqueta("Não instalada")
      : !local.ativa ? etiqueta("Instalada, desativada", "alerta")
      : local.ligada ? etiqueta(`Ligada agora (${local.dispositivo === "gpu" ? "placa de vídeo" : "processador"})`, "bom")
      : etiqueta("Instalada, liga sozinha quando precisar", "bom");
    return h("section.bloco", {}, h("h2", {}, "IA local", situacao),
      h("p", {}, "Um modelo aberto de visão e linguagem que roda neste computador, sem internet e sem custo. Ele interpreta os personagens e elementos das cenas, o humor das falas, os enquadramentos, a tipografia e a narrativa das referências, e redige o roteiro. Nada é enviado para fora."),
      local.instalada ? h("dl.chaves", {}, h("dt", {}, "Modelo"), h("dd", {}, `${local.modelo.nome} (licença ${local.modelo.licenca})`), h("dt", {}, "Motor"), h("dd", {}, `llama.cpp ${local.motor.versao} — ${local.motor.descricao}`)) : null,
      local.erro ? h("div.nota.erro", { style: "margin-top:10px" }, `Último problema: ${local.erro}`) : null,
      instalando ? h("div.nota", { style: "margin-top:12px" }, h("strong", {}, instalando.titulo), h("div", {}, h("small", {}, instalando.etapa || "Aguardando"), barra(instalando.estado === "executando" ? instalando.progresso : 0)),
        h("button.pequeno", { style: "margin-top:8px", aoClicar: (e) => agir(e, () => api("/api/ia/local/cancelar", { metodo: "POST" })) }, "Cancelar")) : null,
      h("div.formulario", { style: "margin-top:12px" }, campo(local.instalada ? "Trocar o modelo" : "Modelo", modelo, descricao)),
      h("div.linha", { style: "margin-top:12px" },
        h("button.principal", { disabled: Boolean(instalando), aoClicar: instalar }, !local.instalada ? "Instalar a IA local" : modelo.value === local.modelo?.id ? "Conferir e reparar" : "Instalar este modelo"),
        local.instalada ? [
          h("button", { disabled: Boolean(instalando), title: "Liga a IA local e faz uma pergunta de texto e uma com imagem", aoClicar: (e) => agir(e, async () => { instalando = await api("/api/ia/local/testar", { metodo: "POST" }); desenhar(); }) }, "Testar"),
          h("label.marca-campo", {}, h("input", { type: "checkbox", checked: local.ativa, aoMudar: (e) => agir(e, async () => { local = await api("/api/ia/local", { metodo: "PUT", corpo: { ativa: e.target.checked } }); desenhar(); }) }), "Usar a IA local nas análises"),
          h("span.espaco"), h("button.perigo", { aoClicar: remover }, "Remover"),
        ] : null),
      h("p.ajuda", { style: "margin-top:10px" }, "O download acontece uma vez (cerca de 3 GB para o modelo recomendado). Cada arquivo é conferido pela soma de verificação publicada. A IA local desliga sozinha depois de alguns minutos sem uso, para devolver a memória."));
  }

  function desenhar() {
    por(limpar(area), geral(), iaLocal(), ia(), computador(), seguranca(),
      h("section.bloco", {}, h("h2", {}, "Sobre"), h("p", {}, `IA Editora de Vídeo, versão ${c.versao}. Roda neste computador, com memória própria, sem depender de nenhum outro programa aberto.`),
        h("p.suave", {}, "Para atualizar, use o atalho Atualizar (ou o comando de atualização): ele faz uma cópia de segurança antes e preserva projetos, aprendizados e exportações.")));
  }
  const carregar = async () => {
    [c, copias, local] = await Promise.all([api("/api/configuracoes"), api("/api/backups"), api("/api/ia/local")]);
    instalando = (await api("/api/tarefas")).find((t) => t.tipo === "instalacao-ia-local" && (t.estado === "na-fila" || t.estado === "executando")) ?? null;
    desenhar();
  };

  por(raiz, h("div.cabecalho", {}, h("div", {}, h("h1", {}, "Configurações"), h("div.subtitulo", {}, "Preferências, modelos, provedores de IA opcionais, recursos do computador e cópias de segurança."))), area);
  await carregar();
  return {
    aoEvento: (nome, dados) => {
      if (nome !== "tarefa:atualizada" || dados.tipo !== "instalacao-ia-local") return;
      const ativa = dados.estado === "na-fila" || dados.estado === "executando";
      instalando = ativa ? dados : null;
      if (ativa) {
        const caixa = area.querySelector(".nota .barra > i");
        const etapa = area.querySelector(".nota small");
        if (caixa && etapa && dados.estado === "executando") { caixa.style.width = `${Math.round((dados.progresso ?? 0) * 100)}%`; etapa.textContent = dados.etapa; return; }
        desenhar();
      } else carregar().catch(() => undefined);
    },
  };
}
