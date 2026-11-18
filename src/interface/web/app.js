// Ponto de partida da interface: navegação entre telas, eventos ao vivo e indicador de processamento.

import { agir, api, aviso, barra, confirmar, h, limpar, por } from "/nucleo.js";

const TELAS = {
  painel: () => import("/telas/painel.js"), projetos: () => import("/telas/projetos.js"), projeto: () => import("/telas/projeto.js"),
  referencias: () => import("/telas/referencias.js"), marcas: () => import("/telas/marcas.js"), aprendizado: () => import("/telas/aprendizado.js"), configuracoes: () => import("/telas/configuracoes.js"),
};
const conteudo = document.getElementById("conteudo");
const contexto = { catalogo: null, ir: (destino) => { location.hash = destino; }, recarregar: () => navegar() };
let telaAtual = null;
let navegacao = 0;
const tarefasAtivas = new Map();

function cortina(titulo, texto, comBotao = false) {
  document.getElementById("cortina-titulo").textContent = titulo;
  document.getElementById("cortina-texto").textContent = texto;
  document.getElementById("cortina-acao").hidden = !comBotao;
  document.getElementById("cortina").hidden = false;
}

async function navegar() {
  const partes = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const nome = TELAS[partes[0]] ? partes[0] : "painel";
  const vez = (navegacao += 1);
  for (const link of document.querySelectorAll("#menu a")) link.classList.toggle("ativo", link.dataset.tela === (nome === "projeto" ? "projetos" : nome));
  try {
    const modulo = await TELAS[nome]();
    // Dentro de um projeto, trocar de aba não recarrega a tela inteira.
    if (telaAtual?.nome === nome && telaAtual.aoNavegar && (await telaAtual.aoNavegar(partes.slice(1)))) return;
    telaAtual?.aoSair?.();
    const raiz = h("div");
    const tela = (await modulo.mostrar(raiz, contexto, partes.slice(1))) ?? {};
    if (vez !== navegacao) return; // o usuário já foi para outra tela
    telaAtual = { nome, ...tela };
    por(limpar(conteudo), raiz);
    conteudo.scrollTop = 0;
    window.scrollTo(0, 0);
  } catch (erro) {
    if (vez !== navegacao) return;
    telaAtual = null;
    por(limpar(conteudo), h("div.cabecalho", {}, h("h1", {}, "Não foi possível abrir esta tela")), h("div.nota.erro", {}, erro.message), h("a", { href: "#/painel" }, "Voltar ao painel"));
  }
}

function mostrarProcessamento() {
  const caixa = document.getElementById("processamento");
  const ativas = [...tarefasAtivas.values()];
  caixa.hidden = ativas.length === 0;
  if (ativas.length === 0) return;
  const atual = ativas.find((t) => t.estado === "executando") ?? ativas[0];
  por(limpar(caixa), 
    h("strong", {}, ativas.length === 1 ? "Processando" : `Processando (${ativas.length} na fila)`), h("div", { style: "margin-bottom:6px" }, atual.titulo),
    h("small", {}, atual.etapa || "Aguardando"), barra(atual.estado === "executando" ? atual.progresso : 0),
  );
}

function aoAtualizarTarefa(tarefa) {
  const ativa = tarefa.estado === "na-fila" || tarefa.estado === "executando";
  const estava = tarefasAtivas.has(tarefa.id);
  if (ativa) tarefasAtivas.set(tarefa.id, tarefa);
  else tarefasAtivas.delete(tarefa.id);
  mostrarProcessamento();
  if (estava && !ativa) {
    if (tarefa.estado === "concluida") aviso(`${tarefa.titulo}: concluída.`, "sucesso");
    else if (tarefa.estado === "falhou") aviso(`${tarefa.titulo}: ${tarefa.erro ?? "falhou"}`, "erro");
  }
}

function ouvirEventos() {
  const fonte = new EventSource("/api/eventos");
  let falhas = 0;
  const repassar = (nome) => fonte.addEventListener(nome, (e) => {
    const dados = JSON.parse(e.data);
    if (nome === "tarefa:atualizada") aoAtualizarTarefa(dados);
    telaAtual?.aoEvento?.(nome, dados);
  });
  for (const nome of ["tarefa:atualizada", "render:atualizado", "render:progresso", "atividade"]) repassar(nome);
  fonte.addEventListener("encerrada", () => { fonte.close(); cortina("Aplicação encerrada", "Seus projetos e aprendizados estão salvos. Você já pode fechar esta janela."); });
  fonte.addEventListener("open", () => { falhas = 0; });
  fonte.addEventListener("error", async () => {
    falhas += 1;
    if (falhas < 3 || !document.getElementById("cortina").hidden) return;
    try {
      await fetch("/api/saude");
    } catch {
      fonte.close();
      cortina("A aplicação não está respondendo", "Ela pode ter sido encerrada. Abra de novo pelo atalho ou pelo inicializador (Iniciar).", true);
    }
  });
}

async function iniciar() {
  if (location.search) history.replaceState(null, "", location.pathname + location.hash); // tira o segredo da sessão do endereço
  document.getElementById("cortina-acao").addEventListener("click", () => location.reload());
  document.getElementById("encerrar").addEventListener("click", async (evento) => {
    const emAndamento = tarefasAtivas.size > 0;
    const sim = await confirmar("Encerrar a aplicação?", emAndamento ? "Há processamento em andamento. Renders serão interrompidos com segurança e poderão ser repetidos depois." : "Tudo o que você fez já está salvo.", { rotulo: "Encerrar" });
    if (sim) await agir(evento.target, () => api("/api/encerrar", { metodo: "POST" }));
  });
  try {
    contexto.catalogo = await api("/api/catalogo");
    const painel = await api("/api/painel");
    document.getElementById("versao").textContent = `Versão ${painel.versao}`;
    for (const tarefa of painel.tarefas) if (tarefa.estado === "na-fila" || tarefa.estado === "executando") tarefasAtivas.set(tarefa.id, tarefa);
    mostrarProcessamento();
  } catch (erro) {
    cortina("Não foi possível abrir a aplicação", erro.message, true);
    return;
  }
  ouvirEventos();
  window.addEventListener("hashchange", navegar);
  await navegar();
}

iniciar();
