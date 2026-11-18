// Operações que a interface gráfica pode pedir. Cada rota só traduz o pedido em uma
// chamada à Aplicacao e devolve o resultado em JSON: nenhuma regra de negócio mora aqui.

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { ErroAplicacao, NaoEncontrado } from "../dominio/erros.ts";
import { ASPECTOS } from "../dominio/feedback.ts";
import { CATEGORIAS_EDICAO, type CategoriaEdicao, type EscopoAprendizado } from "../dominio/memoria.ts";
import type { CorDaMarca, Marca, PapelDaCor } from "../dominio/marca.ts";
import type { Capacidade, ConfiguracaoProvedor } from "../dominio/provedores.ts";
import type { Operacao } from "../dominio/timeline.ts";
import type { ConfiguracaoDoProjeto, Projeto } from "../dominio/tipos.ts";
import type { Aplicacao } from "../nucleo/aplicacao.ts";
import type { PedidoDeAvaliacao, PedidoDeResultado } from "../nucleo/feedback.ts";
import { EXTENSOES_DE_AUDIO, EXTENSOES_DE_VIDEO } from "../nucleo/fluxo.ts";
import { detectarServidoresLocais } from "../servicos/provedores.ts";
import { enviarArquivo, ErroDePedido, receberArquivo, type Contexto } from "./servidor.ts";
import { abrirPasta } from "./sistema.ts";

export interface Rota {
  metodo: "GET" | "POST" | "PUT" | "DELETE";
  caminho: string;
  /** A rota recebe um arquivo no corpo do pedido (não é JSON). */
  envio?: boolean;
  atender(c: Contexto): unknown;
}

const MODELOS_DE_TRANSCRICAO = ["tiny", "base", "small", "medium", "large-v3", "turbo"];

/** O que funciona só com o computador e o que melhora com um modelo de linguagem ou de visão (local ou externo). */
const RECURSOS = [
  { recurso: "Importação e análise técnica dos vídeos", local: true, modelo: "Não usa" },
  { recurso: "Cenas, movimento, áudio, silêncios e possíveis erros", local: true, modelo: "Não usa" },
  { recurso: "Transcrição da fala", local: true, modelo: "Whisper, neste computador" },
  { recurso: "Pesquisa nos vídeos brutos", local: true, modelo: "Não usa" },
  { recurso: "Plano de edição e montagem da timeline", local: true, modelo: "Não usa" },
  { recurso: "Prévia, renderização e exportação", local: true, modelo: "Não usa" },
  { recurso: "Controle de qualidade", local: true, modelo: "Não usa" },
  { recurso: "Memória, feedback e aprendizado", local: true, modelo: "Não usa" },
  { recurso: "Roteiro", local: true, modelo: "Sem modelo: estrutura com os fatos do material. Com a IA local ou outro modelo de linguagem: texto de narração redigido." },
  { recurso: "Personagens e elementos visuais nos vídeos brutos", local: false, modelo: "Exige modelo de visão: a IA local (instalável aqui, sem internet) ou um provedor. Sem ele, fica como não avaliado." },
  { recurso: "Humor nas falas dos vídeos brutos", local: false, modelo: "Exige modelo de linguagem: a IA local (instalável aqui, sem internet) ou um provedor. Sem ele, fica como não avaliado." },
  { recurso: "Enquadramentos, tipografia e animações das referências", local: false, modelo: "Exige modelo de visão: a IA local (instalável aqui, sem internet) ou um provedor. Sem ele, fica como não avaliado." },
  { recurso: "Desenvolvimento, suspense e emoção das referências", local: false, modelo: "Exige modelo de linguagem: a IA local (instalável aqui, sem internet) ou um provedor. Sem ele, fica como não avaliado." },
];

const texto = (valor: unknown): string => (typeof valor === "string" ? valor : "");

// --- Marcas: tipos de arquivo aceitos e conferência do que a janela manda ---------------------
const IMAGENS_DE_LOGO = new Set([".png", ".svg", ".gif", ".jpg", ".jpeg", ".webp"]);
const ARQUIVOS_DE_FONTE = new Set([".ttf", ".otf", ".woff", ".woff2"]);
const MATERIAIS_DA_MARCA = new Set([".pdf", ...IMAGENS_DE_LOGO, ...ARQUIVOS_DE_FONTE, ".txt", ".md"]);
const PAPEIS_DE_ARQUIVO: Record<string, Set<string>> = { logo: IMAGENS_DE_LOGO, logoClaro: IMAGENS_DE_LOGO, material: MATERIAIS_DA_MARCA, "fonte-titulos": ARQUIVOS_DE_FONTE, "fonte-texto": ARQUIVOS_DE_FONTE };
const PAPEIS_DE_COR = new Set(["primaria", "secundaria", "destaque", "texto", "fundo"]);
const CANTOS = new Set(["superior-direito", "superior-esquerdo", "inferior-direito", "inferior-esquerdo"]);

function coresDoPedido(valor: unknown): CorDaMarca[] {
  if (!Array.isArray(valor)) throw new ErroDePedido(400, "As cores precisam vir em lista.");
  return valor.map((c: Record<string, unknown>) => {
    const hex = texto(c?.hex).trim();
    if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new ErroDePedido(400, `Cor inválida: "${hex}". Use o formato #RRGGBB.`);
    const papel = texto(c.papel);
    return {
      hex: hex.toUpperCase(), papel: PAPEIS_DE_COR.has(papel) ? (papel as PapelDaCor) : null,
      base: c.base === "estimado" ? "estimado" : "observado", fonte: texto(c.fonte) || "escolhida pelo usuário",
    };
  });
}

function posicaoDoLogo(valor: Record<string, unknown>): Marca["logoPosicao"] {
  const canto = texto(valor?.canto), altura = Number(valor?.alturaRelativa), opacidade = Number(valor?.opacidade);
  if (!CANTOS.has(canto) || !(altura >= 0.03 && altura <= 0.3) || !(opacidade >= 0.2 && opacidade <= 1)) throw new ErroDePedido(400, "Posição do logo inválida (altura de 3% a 30% e opacidade de 20% a 100%).");
  return { canto: canto as Marca["logoPosicao"]["canto"], alturaRelativa: altura, opacidade };
}

/** Recebe um arquivo enviado pela janela numa pasta temporária; a marca guarda uma cópia. */
async function receberParaAMarca(app: Aplicacao, req: Parameters<typeof receberArquivo>[0], nome: string, aceitos: Set<string>): Promise<string> {
  return receberArquivo(req, path.join(app.caminhos.temporarios, "envios-de-marca"), nome, aceitos);
}
const numero = (valor: unknown): number | undefined => (valor === undefined || valor === null || valor === "" || !Number.isFinite(Number(valor)) ? undefined : Number(valor));
const inteiro = (valor: string): number => {
  const n = Number(valor);
  if (!Number.isInteger(n)) throw new ErroDePedido(400, "Identificador inválido.");
  return n;
};
/** Devolve nulo quando o que se procura ainda não existe (projeto sem plano, sem timeline...). */
const ou = <T>(buscar: () => T): T | null => {
  try {
    return buscar();
  } catch (erro) {
    if (erro instanceof NaoEncontrado) return null;
    throw erro;
  }
};

function resumoDoProjeto(app: Aplicacao, projeto: Projeto) {
  const brutos = app.projetos.midias(projeto.id, "bruto");
  const analisados = brutos.filter((m) => app.producao.analisado(m) !== null).length;
  const plano = ou(() => app.acervo.plano(projeto.id));
  const timeline = ou(() => app.edicao.timeline(projeto.id));
  const exportacoes = app.edicao.exportacoes(projeto.id);
  const concluidas = (tipo: string) => exportacoes.filter((e) => e.tipo === tipo && e.estado === "concluida").length;
  const etapa = brutos.length === 0 ? "material" : analisados < brutos.length ? "analise" : !plano ? "plano" : plano.estado !== "aprovado" ? "aprovacao"
    : !timeline ? "edicao" : concluidas("final") > 0 ? "concluido" : concluidas("previa") > 0 ? "exportacao" : "previa";
  return {
    ...projeto, perfilNome: ou(() => app.perfis.obter(projeto.perfil).nome) ?? projeto.perfil, formatoEfetivo: ou(() => app.producao.formatoDoProjeto(projeto)),
    pastaDeBrutos: app.fluxo.pastaDeBrutos(projeto),
    resumo: {
      brutos: brutos.length, analisados, referencias: app.acervo.referencias(projeto.id).length, plano: plano ? { versao: plano.versao, estado: plano.estado } : null,
      timeline: timeline ? { versao: timeline.versao, duracaoSeg: timeline.timeline.duracaoSeg } : null, previas: concluidas("previa"), exportacoes: concluidas("final"), etapa,
    },
  };
}

function brutosDoProjeto(app: Aplicacao, projetoId: string) {
  return app.projetos.midias(projetoId, "bruto").map((midia) => {
    const analise = app.producao.analisado(midia);
    const conteudo = analise?.conteudo ?? null;
    const existe = existsSync(midia.caminho);
    return {
      id: midia.id, nome: path.basename(midia.caminho), caminho: midia.caminho, existe, tamanhoBytes: existe ? statSync(midia.caminho).size : null, analisado: analise !== null,
      integridade: analise?.arquivo.integridade ?? null, tecnico: analise?.arquivo.tecnico ?? null, problemas: [...(analise?.arquivo.problemas ?? []), ...(conteudo?.possiveisErros ?? [])],
      cenas: conteudo?.cenas.length ?? 0, falas: conteudo?.transcricao?.segmentos.length ?? 0, momentosDeAcao: conteudo?.momentosDeAcao.length ?? 0, destaques: conteudo?.destaques.length ?? 0,
      miniatura: conteudo?.cenas.find((cena) => cena.miniatura)?.indice ?? null,
    };
  });
}

const midiaDoProjeto = (app: Aplicacao, projetoId: string, midiaId: string) => {
  const midia = app.projetos.midias(projetoId, "bruto").find((m) => m.id === midiaId);
  if (!midia) throw new NaoEncontrado("Vídeo bruto", midiaId);
  return midia;
};

const exportacaoDoProjeto = (app: Aplicacao, projetoId: string, id: string) => {
  const exportacao = app.edicao.exportacoes(projetoId).find((e) => e.id === inteiro(id));
  if (!exportacao) throw new NaoEncontrado("Exportação", id);
  return exportacao;
};

const exportacoesDoProjeto = (app: Aplicacao, projetoId: string) =>
  app.edicao.exportacoes(projetoId).map((e) => {
    const relatorio = e.tipo === "final" ? app.qualidade.relatorioDaExportacao(e.id) : null;
    return { ...e, arquivoExiste: Boolean(e.arquivo && existsSync(e.arquivo)), relatorio: relatorio ? { id: relatorio.id, situacao: relatorio.situacao, destino: relatorio.perfilDeQualidade } : null };
  });

function referencias(app: Aplicacao, projetoId?: string) {
  const vinculadas = new Set(projetoId ? app.acervo.referencias(projetoId).map((r) => r.id) : []);
  return app.acervo.referencias().map((r) => ({
    ...r, existe: Boolean(r.caminho && existsSync(r.caminho)), analisada: app.referencias.relatorio(r.id) !== null, vinculada: vinculadas.has(r.id),
  }));
}

function planoDoProjeto(app: Aplicacao, projetoId: string) {
  const projeto = app.projetos.obter(projetoId);
  return {
    atual: ou(() => app.acervo.plano(projetoId)),
    historico: app.acervo.historicoDePlanos(projetoId).map((v) => ({ versao: v.versao, estado: v.estado, autor: v.autor, nota: v.nota, criadoEm: v.criadoEm })),
    roteiro: app.producao.roteiro(projetoId) ?? null,
    pronto: { objetivo: Boolean(projeto.configuracao.objetivo), material: app.projetos.midias(projetoId, "bruto").some((m) => app.producao.analisado(m)?.conteudo) },
  };
}

function timelineDoProjeto(app: Aplicacao, projetoId: string) {
  app.projetos.obter(projetoId);
  return {
    atual: ou(() => app.edicao.timeline(projetoId)),
    historico: app.edicao.historico(projetoId).map((v) => ({ versao: v.versao, autor: v.autor, nota: v.nota, criadoEm: v.criadoEm })),
    montagem: app.memoria.recordar(`projeto:${projetoId}`, "montagem") ?? null,
    planoAprovado: app.acervo.planoAprovado(projetoId) !== null,
  };
}

async function configuracoes(app: Aplicacao) {
  const situacao = await app.provedores.situacao();
  const c = app.configuracoes;
  const baixados = existsSync(app.caminhos.modelos)
    ? MODELOS_DE_TRANSCRICAO.filter((modelo) => readdirSync(app.caminhos.modelos, { recursive: true }).some((nome) => String(nome).toLowerCase().includes(`whisper-${modelo}`)))
    : [];
  return {
    versao: app.versao(), perfilPadrao: c.perfilPadrao, transcricao: c.transcricao, backup: c.backup, processamento: c.processamento,
    ia: { preferirLocal: c.ia.preferirLocal, permitirExternos: c.ia.permitirExternos },
    provedores: app.provedoresConfigurados().map((p) => ({ ...p, estado: situacao.find((s) => s.id === p.id) ?? null })),
    transcricaoLocal: { modelos: MODELOS_DE_TRANSCRICAO, baixados },
    hardware: app.hardware, vramLivreMB: app.vram.livreMB, recursos: RECURSOS,
    pastas: { programa: app.caminhos.programa, dados: app.caminhos.dados, brutos: app.caminhos.brutos, referencias: app.caminhos.referencias, exportacoes: app.caminhos.exportacoes, backups: app.caminhos.backups },
  };
}

const semTrabalhoEmAndamento = (app: Aplicacao, acao: string): void => {
  if (app.tarefas.emAndamento().length > 0) throw new ErroAplicacao("ocupada", `Espere o processamento em andamento terminar antes de ${acao}.`);
};

export const ROTAS: Rota[] = [
  // --- Painel e catálogos ---------------------------------------------------------------------
  {
    metodo: "GET", caminho: "/api/painel",
    atender: ({ app }) => {
      const projetos = app.projetos.listar();
      const nomes = new Map(projetos.map((p) => [p.id, p.nome]));
      return {
        versao: app.versao(), avisos: app.avisos, totalDeProjetos: projetos.length, projetos: projetos.slice(0, 8).map((p) => resumoDoProjeto(app, p)),
        atividades: app.atividades.listar({ limite: 30 }).map((a) => ({ ...a, projetoNome: a.projetoId ? (nomes.get(a.projetoId) ?? null) : null })),
        tarefas: app.tarefas.listar().slice(0, 20),
      };
    },
  },
  {
    metodo: "GET", caminho: "/api/catalogo",
    atender: ({ app }) => ({
      perfis: app.perfis.listar().map((p) => ({ id: p.id, nome: p.nome, descricao: p.descricao, formatoPadrao: p.formatoPadrao, formatos: p.formatos, diretrizes: p.diretrizes })),
      estilos: app.estilos.listar().map((e) => ({ id: e.id, nome: e.nome, descricao: e.descricao })),
      marcas: app.marcas.listar().filter((m) => m.estado === "pronta").map((m) => ({ id: m.id, nome: m.nome })),
      presets: app.catalogoDeQualidade.listarPresets(), destinos: app.catalogoDeQualidade.listarPerfis().map((d) => ({ id: d.id, nome: d.nome })),
      categorias: CATEGORIAS_EDICAO, aspectos: Object.keys(ASPECTOS), perfilPadrao: app.configuracoes.perfilPadrao,
      extensoesDeVideo: [...EXTENSOES_DE_VIDEO], extensoesDeAudio: [...EXTENSOES_DE_AUDIO],
    }),
  },
  { metodo: "GET", caminho: "/api/tarefas", atender: ({ app }) => app.tarefas.listar() },
  { metodo: "POST", caminho: "/api/encerrar", atender: ({ servidor }) => { servidor.pedirEncerramento(); return { encerrando: true }; } },
  {
    metodo: "POST", caminho: "/api/abrir",
    atender: ({ app, corpo }) => {
      const projeto = texto(corpo.projetoId) ? app.projetos.obter(texto(corpo.projetoId)) : null;
      const pastas: Record<string, string> = {
        brutos: projeto ? app.fluxo.pastaDeBrutos(projeto) : app.caminhos.brutos, referencias: app.caminhos.referencias,
        exportacoes: projeto && existsSync(path.join(app.caminhos.exportacoes, projeto.nome)) ? path.join(app.caminhos.exportacoes, projeto.nome) : app.caminhos.exportacoes,
        backups: app.caminhos.backups, dados: app.caminhos.dados,
      };
      const pasta = pastas[texto(corpo.alvo)];
      if (!pasta) throw new ErroDePedido(400, "Pasta desconhecida.");
      mkdirSync(pasta, { recursive: true });
      abrirPasta(pasta);
      return { pasta };
    },
  },

  // --- Projetos -------------------------------------------------------------------------------
  { metodo: "GET", caminho: "/api/projetos", atender: ({ app }) => app.projetos.listar().map((p) => resumoDoProjeto(app, p)) },
  {
    metodo: "POST", caminho: "/api/projetos",
    atender: ({ app, corpo }) =>
      resumoDoProjeto(app, app.fluxo.criarProjeto({ nome: texto(corpo.nome), perfil: texto(corpo.perfil) || app.configuracoes.perfilPadrao, configuracao: (corpo.configuracao ?? {}) as Partial<ConfiguracaoDoProjeto> })),
  },
  { metodo: "GET", caminho: "/api/projetos/:id", atender: ({ app, p }) => resumoDoProjeto(app, app.projetos.obter(p.id)) },
  {
    metodo: "PUT", caminho: "/api/projetos/:id",
    atender: ({ app, p, corpo }) =>
      resumoDoProjeto(app, app.fluxo.configurar(p.id, {
        nome: corpo.nome === undefined ? undefined : texto(corpo.nome), perfil: texto(corpo.perfil) || undefined, configuracao: (corpo.configuracao ?? {}) as Partial<ConfiguracaoDoProjeto>,
      })),
  },
  {
    metodo: "DELETE", caminho: "/api/projetos/:id",
    atender: ({ app, p }) => {
      semTrabalhoEmAndamento(app, "remover um projeto");
      const projeto = app.projetos.obter(p.id);
      app.projetos.remover(p.id);
      app.fluxo.registrar("projeto", `Projeto "${projeto.nome}" removido. Os vídeos e as exportações continuam nas pastas.`);
    },
  },
  { metodo: "GET", caminho: "/api/projetos/:id/atividades", atender: ({ app, p }) => app.atividades.listar({ projetoId: app.projetos.obter(p.id).id, limite: 100 }) },

  // --- Vídeos brutos e análise ------------------------------------------------------------------
  { metodo: "GET", caminho: "/api/projetos/:id/brutos", atender: ({ app, p }) => brutosDoProjeto(app, app.projetos.obter(p.id).id) },
  { metodo: "POST", caminho: "/api/projetos/:id/brutos/importar", atender: ({ app, p }) => ({ novos: app.fluxo.importarBrutos(p.id), brutos: brutosDoProjeto(app, p.id) }) },
  {
    metodo: "POST", caminho: "/api/projetos/:id/brutos/arquivo", envio: true,
    atender: async ({ app, p, consulta, req }) => {
      const arquivo = await receberArquivo(req, app.fluxo.pastaDeBrutos(app.projetos.obter(p.id)), consulta.get("nome") ?? "", EXTENSOES_DE_VIDEO);
      app.fluxo.importarBrutos(p.id);
      return { arquivo: path.basename(arquivo) };
    },
  },
  {
    metodo: "POST", caminho: "/api/projetos/:id/brutos/analisar",
    atender: ({ app, p, corpo }) => app.fluxo.analisarBrutos(p.id, { transcrever: corpo.transcrever !== false, refazer: corpo.refazer === true }).tarefa,
  },
  {
    metodo: "GET", caminho: "/api/projetos/:id/brutos/:midia",
    atender: ({ app, p }) => {
      const midia = midiaDoProjeto(app, p.id, p.midia);
      const analise = app.producao.analisado(midia);
      const miniatura = (indice: number) => `/api/projetos/${p.id}/brutos/${midia.id}/miniaturas/${indice}`;
      return {
        id: midia.id, nome: path.basename(midia.caminho), arquivo: analise?.arquivo ?? null,
        conteudo: analise?.conteudo ? { ...analise.conteudo, cenas: analise.conteudo.cenas.map((cena) => ({ ...cena, miniatura: cena.miniatura ? miniatura(cena.indice) : null })) } : null,
      };
    },
  },
  {
    metodo: "GET", caminho: "/api/projetos/:id/brutos/:midia/miniaturas/:cena",
    atender: ({ app, p, req, res }) => {
      const cena = app.producao.analisado(midiaDoProjeto(app, p.id, p.midia))?.conteudo?.cenas.find((c) => c.indice === inteiro(p.cena));
      if (!cena?.miniatura) throw new ErroDePedido(404, "Miniatura não encontrada.");
      enviarArquivo(req, res, cena.miniatura);
    },
  },
  { metodo: "GET", caminho: "/api/projetos/:id/brutos/:midia/arquivo", atender: ({ app, p, req, res }) => enviarArquivo(req, res, midiaDoProjeto(app, p.id, p.midia).caminho) },
  {
    metodo: "GET", caminho: "/api/projetos/:id/pesquisa",
    atender: ({ app, p, consulta }) => (consulta.get("q")?.trim() ? app.producao.pesquisar(consulta.get("q") as string, { projetoId: app.projetos.obter(p.id).id, limite: 40 }) : []),
  },

  // --- Marcas (identidade visual) -------------------------------------------------------------------
  { metodo: "GET", caminho: "/api/marcas", atender: ({ app }) => app.marcas.listar() },
  { metodo: "POST", caminho: "/api/marcas", atender: ({ app, corpo }) => { const marca = app.marcas.criar(texto(corpo.nome)); app.fluxo.registrar("marca", `Marca "${marca.nome}" criada.`); return marca; } },
  { metodo: "GET", caminho: "/api/marcas/:id", atender: ({ app, p }) => app.marcas.obter(p.id) },
  {
    metodo: "PUT", caminho: "/api/marcas/:id",
    atender: ({ app, p, corpo }) => app.marcas.atualizar(p.id, {
      nome: corpo.nome !== undefined ? texto(corpo.nome) : undefined,
      cores: corpo.cores !== undefined ? coresDoPedido(corpo.cores) : undefined,
      logoPosicao: corpo.logoPosicao !== undefined ? posicaoDoLogo(corpo.logoPosicao as Record<string, unknown>) : undefined,
    }),
  },
  { metodo: "DELETE", caminho: "/api/marcas/:id", atender: ({ app, p }) => { const { nome } = app.marcas.obter(p.id); app.marcas.remover(p.id); app.fluxo.registrar("marca", `Marca "${nome}" removida.`); return { removida: true }; } },
  {
    metodo: "POST", caminho: "/api/marcas/:id/arquivo", envio: true,
    atender: async ({ app, p, consulta, req }) => {
      const papel = consulta.get("papel") ?? "";
      const aceitos = PAPEIS_DE_ARQUIVO[papel];
      if (!aceitos) throw new ErroDePedido(400, "Papel do arquivo desconhecido.");
      app.marcas.obter(p.id);
      const temporario = await receberParaAMarca(app, req, consulta.get("nome") ?? "", aceitos);
      try {
        app.marcas.guardarArquivo(p.id, temporario, papel as Parameters<typeof app.marcas.guardarArquivo>[2]);
      } finally {
        rmSync(temporario, { force: true });
      }
      return app.marcas.obter(p.id);
    },
  },
  {
    // O manual em PDF: a marca guarda uma cópia e a leitura roda como tarefa com porcentagem.
    metodo: "POST", caminho: "/api/marcas/:id/manual", envio: true,
    atender: async ({ app, p, consulta, req }) => {
      app.marcas.obter(p.id);
      const temporario = await receberParaAMarca(app, req, consulta.get("nome") ?? "manual.pdf", new Set([".pdf"]));
      const { tarefa, conclusao } = app.fluxoDeMarcas.lerManual(p.id, temporario);
      void conclusao.finally(() => rmSync(temporario, { force: true }));
      return tarefa;
    },
  },
  { metodo: "POST", caminho: "/api/marcas/:id/logo-sugerido", atender: ({ app, p, corpo }) => app.fluxoDeMarcas.usarLogoSugerido(p.id, Number(corpo.indice)) },
  { metodo: "POST", caminho: "/api/marcas/:id/cores-do-logo", atender: ({ app, p }) => app.fluxoDeMarcas.coresDoLogo(p.id) },
  {
    // Só roda quando a janela pede: a confirmação ("Baixar do Google Fonts?") é feita lá.
    metodo: "POST", caminho: "/api/marcas/:id/fontes/google",
    atender: ({ app, p, corpo }) => {
      const papel = texto(corpo.papel) === "texto" ? "texto" : "titulos";
      if (!texto(corpo.nome).trim()) throw new ErroDePedido(400, "Informe o nome da fonte.");
      return app.fluxoDeMarcas.baixarFonteDoGoogle(p.id, papel, texto(corpo.nome)).tarefa;
    },
  },
  {
    metodo: "POST", caminho: "/api/marcas/:id/fontes/pendente",
    atender: ({ app, p, corpo }) => {
      const papel = texto(corpo.papel) === "texto" ? "texto" : "titulos";
      if (!texto(corpo.nome).trim()) throw new ErroDePedido(400, "Informe o nome da fonte.");
      return app.marcas.definirFonte(p.id, papel, { nome: texto(corpo.nome).trim(), arquivos: [], origem: "pendente", licenca: "" });
    },
  },
  { metodo: "POST", caminho: "/api/marcas/:id/pronta", atender: ({ app, p }) => { const marca = app.marcas.marcarPronta(p.id); app.fluxo.registrar("marca", `Marca "${marca.nome}" pronta para os projetos.`); return marca; } },
  {
    // Imagens da marca por identificador, nunca por caminho: logo, logo-claro, sugestao-<n>.
    metodo: "GET", caminho: "/api/marcas/:id/imagem/:qual",
    atender: ({ app, p, req, res }) => {
      const marca = app.marcas.obter(p.id);
      const sugestao = /^sugestao-(\d+)$/.exec(p.qual);
      const arquivo = p.qual === "logo" ? marca.logo : p.qual === "logo-claro" ? marca.logoClaro : sugestao ? marca.sugestoes?.logos[Number(sugestao[1])]?.arquivo : null;
      if (!arquivo || !existsSync(arquivo)) throw new ErroDePedido(404, "Imagem não encontrada.");
      enviarArquivo(req, res, arquivo);
    },
  },

  // --- Referências ------------------------------------------------------------------------------
  { metodo: "GET", caminho: "/api/referencias", atender: ({ app, consulta }) => referencias(app, consulta.get("projeto") ?? undefined) },
  {
    metodo: "POST", caminho: "/api/referencias/importar",
    atender: ({ app, consulta }) => {
      const novas = app.referencias.importarPasta();
      if (novas.length) app.fluxo.registrar("material", `${novas.length} referência(s) adicionada(s).`);
      return { novas: novas.length, referencias: referencias(app, consulta.get("projeto") ?? undefined) };
    },
  },
  {
    metodo: "POST", caminho: "/api/referencias/arquivo", envio: true,
    atender: async ({ app, consulta, req }) => {
      const perfil = consulta.get("perfil") ? app.perfis.obter(consulta.get("perfil") as string).id : undefined;
      const projeto = consulta.get("projeto") ? app.projetos.obter(consulta.get("projeto") as string) : null;
      const arquivo = await receberArquivo(req, perfil ? path.join(app.caminhos.referencias, perfil) : app.caminhos.referencias, consulta.get("nome") ?? "", EXTENSOES_DE_VIDEO);
      const referencia = app.referencias.importar(arquivo, { perfil });
      if (projeto) app.acervo.vincularReferencia(projeto.id, referencia.id);
      app.fluxo.registrar("material", `Referência "${referencia.titulo}" adicionada.`, projeto?.id ?? null);
      return referencia;
    },
  },
  {
    // Um link por linha; cada um vira uma tarefa com porcentagem. Um link ruim não impede os outros.
    metodo: "POST", caminho: "/api/referencias/links",
    atender: ({ app, corpo }) => {
      const links = texto(corpo.links).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (links.length === 0) throw new ErroDePedido(400, "Cole pelo menos um link.");
      const perfil = texto(corpo.perfil) ? app.perfis.obter(texto(corpo.perfil)).id : undefined;
      const projeto = texto(corpo.projeto) ? app.projetos.obter(texto(corpo.projeto)) : null;
      const tarefas = links.map((link) => app.tarefas.iniciar({ tipo: "download-de-referencia", titulo: `Baixando referência: ${link}`, projetoId: projeto?.id ?? null }, async (informar) => {
        const { referencia, jaExistia, site } = await app.referencias.baixarDeLink(link, { perfil, projetoId: projeto?.id }, informar);
        app.fluxo.registrar("material", jaExistia ? `Referência "${referencia.titulo}" já existia.` : `Referência "${referencia.titulo}" baixada de ${site}.`, projeto?.id ?? null);
        return referencia;
      }).tarefa);
      return { tarefas };
    },
  },
  {
    metodo: "POST", caminho: "/api/referencias/analisar",
    atender: ({ app, corpo }) => {
      const ids = Array.isArray(corpo.ids) ? corpo.ids.map(texto).filter(Boolean) : [];
      if (ids.length === 0) throw new ErroDePedido(400, "Escolha pelo menos uma referência.");
      return app.fluxo.analisarReferencias(ids, { transcrever: corpo.transcrever !== false }).tarefa;
    },
  },
  {
    metodo: "GET", caminho: "/api/referencias/:id/relatorio",
    atender: ({ app, p }) => ({ referencia: app.acervo.referencia(p.id), relatorio: app.referencias.relatorio(p.id), markdown: app.referencias.relatorioEmMarkdown(p.id) }),
  },
  {
    metodo: "GET", caminho: "/api/referencias/:id/arquivo",
    atender: ({ app, p, req, res }) => {
      const caminho = app.acervo.referencia(p.id).caminho;
      if (!caminho) throw new ErroDePedido(404, "Esta referência não tem arquivo local.");
      enviarArquivo(req, res, caminho);
    },
  },
  {
    metodo: "DELETE", caminho: "/api/referencias/:id",
    atender: ({ app, p }) => {
      const referencia = app.acervo.referencia(p.id);
      app.aprendizado.esquecerReferencia(p.id);
      app.acervo.removerReferencia(p.id);
      app.fluxo.registrar("material", `Referência "${referencia.titulo}" removida, com o que ela havia ensinado. O arquivo continua na pasta.`);
    },
  },
  {
    metodo: "POST", caminho: "/api/projetos/:id/referencias/:referencia",
    atender: ({ app, p }) => { app.acervo.vincularReferencia(app.projetos.obter(p.id).id, app.acervo.referencia(p.referencia).id); },
  },

  // --- Plano e roteiro --------------------------------------------------------------------------
  { metodo: "GET", caminho: "/api/projetos/:id/plano", atender: ({ app, p }) => planoDoProjeto(app, p.id) },
  { metodo: "POST", caminho: "/api/projetos/:id/plano", atender: ({ app, p }) => { app.fluxo.planejar(p.id); return planoDoProjeto(app, p.id); } },
  {
    metodo: "POST", caminho: "/api/projetos/:id/plano/aprovar",
    atender: ({ app, p }) => {
      const r = app.fluxo.aprovarPlano(p.id);
      return { ...planoDoProjeto(app, p.id), timelineMontada: r.timeline?.versao ?? null, previaIniciada: r.previa?.id ?? null, avisos: r.avisos };
    },
  },
  { metodo: "POST", caminho: "/api/projetos/:id/plano/rejeitar", atender: ({ app, p, corpo }) => { app.fluxo.rejeitarPlano(p.id, texto(corpo.motivo)); return planoDoProjeto(app, p.id); } },
  { metodo: "POST", caminho: "/api/projetos/:id/roteiro", atender: async ({ app, p }) => { await app.fluxo.escreverRoteiro(p.id); return planoDoProjeto(app, p.id); } },

  // --- Timeline -----------------------------------------------------------------------------------
  { metodo: "GET", caminho: "/api/projetos/:id/timeline", atender: ({ app, p }) => timelineDoProjeto(app, p.id) },
  {
    metodo: "POST", caminho: "/api/projetos/:id/timeline/montar",
    atender: ({ app, p, corpo }) => {
      const r = app.fluxo.montar(p.id, Array.isArray(corpo.estilos) ? corpo.estilos.map(texto).filter(Boolean) : undefined);
      return { ...timelineDoProjeto(app, p.id), avisos: r.avisos, previaIniciada: r.previa?.id ?? null };
    },
  },
  {
    metodo: "POST", caminho: "/api/projetos/:id/timeline/operacoes",
    atender: ({ app, p, corpo }) => {
      const operacoes = (Array.isArray(corpo.operacoes) ? corpo.operacoes : [corpo.operacao]).filter(Boolean) as Operacao[];
      if (operacoes.length === 0) throw new ErroDePedido(400, "Nenhuma alteração informada.");
      const versao = app.edicao.editar(p.id, operacoes, texto(corpo.nota) || undefined);
      app.fluxo.registrar("edicao", `Timeline alterada (v${versao.versao})${versao.nota ? `: ${versao.nota}` : "."}`, p.id);
      return timelineDoProjeto(app, p.id);
    },
  },
  {
    metodo: "POST", caminho: "/api/projetos/:id/timeline/restaurar",
    atender: ({ app, p, corpo }) => {
      const versao = app.edicao.restaurar(p.id, numero(corpo.versao));
      app.fluxo.registrar("edicao", `Timeline restaurada: ${versao.nota}`, p.id);
      return timelineDoProjeto(app, p.id);
    },
  },
  {
    metodo: "POST", caminho: "/api/projetos/:id/timeline/trilha", envio: true,
    atender: async ({ app, p, consulta, req }) => {
      const arquivo = await receberArquivo(req, path.join(app.fluxo.pastaDeBrutos(app.projetos.obter(p.id)), "Trilha"), consulta.get("nome") ?? "", EXTENSOES_DE_AUDIO);
      app.edicao.definirTrilha(p.id, arquivo, numero(consulta.get("volume")) ?? 0.6);
      app.fluxo.registrar("edicao", `Trilha sonora definida: ${path.basename(arquivo)}.`, p.id);
      return timelineDoProjeto(app, p.id);
    },
  },
  {
    metodo: "GET", caminho: "/api/projetos/:id/timeline/comparacao",
    atender: ({ app, p, consulta }) => app.feedback.compararVersoes(p.id, numero(consulta.get("de")), numero(consulta.get("para"))),
  },

  // --- Prévia, exportação e qualidade ---------------------------------------------------------------
  { metodo: "POST", caminho: "/api/projetos/:id/previa", atender: ({ app, p, corpo }) => app.fluxo.previa(p.id, numero(corpo.versao)).exportacao },
  {
    metodo: "POST", caminho: "/api/projetos/:id/exportar",
    atender: ({ app, p, corpo }) => app.fluxo.exportar(p.id, { preset: texto(corpo.preset) || undefined, perfilDeQualidade: texto(corpo.destino) || undefined, versao: numero(corpo.versao) }).exportacao,
  },
  { metodo: "POST", caminho: "/api/projetos/:id/qualidade", atender: ({ app, p, corpo }) => app.qualidade.verificarTimeline(p.id, { perfil: texto(corpo.destino) || undefined }) },
  { metodo: "GET", caminho: "/api/projetos/:id/exportacoes", atender: ({ app, p }) => exportacoesDoProjeto(app, app.projetos.obter(p.id).id) },
  { metodo: "POST", caminho: "/api/projetos/:id/exportacoes/:exportacao/cancelar", atender: ({ app, p }) => { app.edicao.cancelar(exportacaoDoProjeto(app, p.id, p.exportacao).id); } },
  { metodo: "POST", caminho: "/api/projetos/:id/exportacoes/:exportacao/repetir", atender: ({ app, p }) => app.fluxo.repetir(exportacaoDoProjeto(app, p.id, p.exportacao).id).exportacao },
  {
    metodo: "GET", caminho: "/api/projetos/:id/exportacoes/:exportacao/arquivo",
    atender: ({ app, p, consulta, req, res }) => {
      const exportacao = exportacaoDoProjeto(app, p.id, p.exportacao);
      if (!exportacao.arquivo) throw new ErroDePedido(404, "Esta exportação não gerou arquivo.");
      enviarArquivo(req, res, exportacao.arquivo, consulta.get("baixar") ? path.basename(exportacao.arquivo) : undefined);
    },
  },
  {
    metodo: "GET", caminho: "/api/projetos/:id/exportacoes/:exportacao/relatorio",
    atender: ({ app, p }) => {
      const relatorio = app.qualidade.relatorioDaExportacao(exportacaoDoProjeto(app, p.id, p.exportacao).id);
      if (!relatorio) throw new ErroDePedido(404, "Esta exportação não tem relatório de qualidade.");
      return { relatorio, markdown: app.qualidade.markdown(relatorio.id) };
    },
  },
  {
    metodo: "POST", caminho: "/api/projetos/:id/relatorios/:relatorio/excecoes",
    atender: ({ app, p, corpo }) => {
      if (app.qualidade.relatorio(inteiro(p.relatorio)).projetoId !== p.id) throw new NaoEncontrado("Relatório de qualidade", p.relatorio);
      const relatorio = app.qualidade.aceitarExcecao(inteiro(p.relatorio), texto(corpo.verificacaoId), texto(corpo.justificativa));
      app.fluxo.registrar("render", `Exceção aceita no relatório de qualidade #${relatorio.id}: ${texto(corpo.verificacaoId)}.`, p.id);
      return { relatorio, markdown: app.qualidade.markdown(relatorio.id) };
    },
  },

  // --- Avaliação e resultados -------------------------------------------------------------------------
  {
    metodo: "GET", caminho: "/api/projetos/:id/avaliacoes",
    atender: ({ app, p }) => ({ avaliacoes: app.feedback.avaliacoes(app.projetos.obter(p.id).id), trechos: app.feedback.trechosEmRevisao(p.id, false), resultados: app.feedback.resultados(p.id) }),
  },
  { metodo: "POST", caminho: "/api/projetos/:id/avaliacoes", atender: ({ app, p, corpo }) => app.fluxo.avaliar(p.id, corpo as unknown as PedidoDeAvaliacao) },
  { metodo: "POST", caminho: "/api/avaliacoes/:id/desfazer", atender: ({ app, p }) => app.feedback.desfazerAvaliacao(inteiro(p.id)) },
  { metodo: "POST", caminho: "/api/trechos/:id/resolver", atender: ({ app, p, corpo }) => { app.feedback.resolverTrecho(inteiro(p.id), corpo.resolvido !== false); } },
  { metodo: "POST", caminho: "/api/projetos/:id/resultados", atender: ({ app, p, corpo }) => app.feedback.registrarResultado(p.id, corpo as unknown as PedidoDeResultado) },
  { metodo: "DELETE", caminho: "/api/resultados/:id", atender: ({ app, p }) => { app.feedback.removerResultado(inteiro(p.id)); } },

  // --- Aprendizado e memória ----------------------------------------------------------------------------
  {
    metodo: "GET", caminho: "/api/aprendizado",
    atender: ({ app }) => ({
      painel: app.feedback.painel(), projetos: Object.fromEntries(app.projetos.listar().map((p) => [p.id, p.nome])),
      perfis: app.perfis.listar().map((p) => ({ id: p.id, nome: p.nome, aprendido: app.feedback.perfilAprendido(p.id) })), acoes: app.aprendizado.acoes().slice(0, 60),
    }),
  },
  { metodo: "GET", caminho: "/api/aprendizados/:id", atender: ({ app, p }) => ({ aprendizado: app.aprendizado.obter(inteiro(p.id)), evidencias: app.aprendizado.evidencias(inteiro(p.id)), acoes: app.aprendizado.acoes(inteiro(p.id)) }) },
  {
    metodo: "PUT", caminho: "/api/aprendizados/:id",
    atender: ({ app, p, corpo }) => app.aprendizado.corrigir(inteiro(p.id), { ...(corpo.descricao !== undefined ? { descricao: texto(corpo.descricao) } : {}), ...(corpo.valor !== undefined ? { valor: corpo.valor } : {}), ...(corpo.contexto !== undefined ? { contexto: texto(corpo.contexto) } : {}) }),
  },
  { metodo: "POST", caminho: "/api/aprendizados/:id/ativar", atender: ({ app, p }) => app.aprendizado.ativar(inteiro(p.id)) },
  { metodo: "POST", caminho: "/api/aprendizados/:id/desativar", atender: ({ app, p }) => app.aprendizado.desativar(inteiro(p.id)) },
  { metodo: "DELETE", caminho: "/api/aprendizados/:id", atender: ({ app, p }) => { app.aprendizado.excluir(inteiro(p.id)); } },
  { metodo: "POST", caminho: "/api/aprendizado/acoes/:id/desfazer", atender: ({ app, p }) => app.aprendizado.desfazerAcao(inteiro(p.id)) },
  {
    // Preferência dita pelo próprio usuário: vale de imediato no contexto escolhido.
    metodo: "POST", caminho: "/api/aprendizado/preferencias",
    atender: ({ app, corpo }) => {
      const descricao = texto(corpo.descricao).trim();
      if (!descricao) throw new ErroDePedido(400, "Descreva a preferência.");
      const escopo = (["geral", "especializacao", "projeto"].includes(texto(corpo.escopo)) ? texto(corpo.escopo) : "geral") as EscopoAprendizado;
      const categoria = (CATEGORIAS_EDICAO as readonly string[]).includes(texto(corpo.categoria)) ? (texto(corpo.categoria) as CategoriaEdicao) : "narrativa";
      const chave = texto(corpo.chave).trim() || descricao.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
      const aprendizado = app.aprendizado.observar({
        escopo, categoria, chave, descricao, origem: "usuario", ...(corpo.valor !== undefined && corpo.valor !== "" ? { valor: corpo.valor } : {}),
        ...(escopo === "especializacao" ? { perfil: app.perfis.obter(texto(corpo.perfil)).id } : {}), ...(escopo === "projeto" ? { projetoId: app.projetos.obter(texto(corpo.projetoId)).id } : {}),
      });
      app.fluxo.registrar("aprendizado", `Preferência registrada: ${descricao}`, escopo === "projeto" ? texto(corpo.projetoId) : null);
      return aprendizado;
    },
  },

  // --- Configurações, provedores de IA e cópias de segurança ------------------------------------------------
  { metodo: "GET", caminho: "/api/configuracoes", atender: ({ app }) => configuracoes(app) },
  {
    metodo: "PUT", caminho: "/api/configuracoes",
    atender: ({ app, corpo }) => {
      const c = app.configuracoes;
      if (corpo.perfilPadrao !== undefined) c.perfilPadrao = app.perfis.obter(texto(corpo.perfilPadrao)).id;
      const transcricao = (corpo.transcricao ?? {}) as Record<string, unknown>;
      if (transcricao.modelo !== undefined) {
        if (!MODELOS_DE_TRANSCRICAO.includes(texto(transcricao.modelo))) throw new ErroDePedido(400, "Modelo de transcrição desconhecido.");
        c.transcricao.modelo = texto(transcricao.modelo);
      }
      if (transcricao.idioma !== undefined) c.transcricao.idioma = texto(transcricao.idioma).trim().toLowerCase().slice(0, 5);
      const backup = (corpo.backup ?? {}) as Record<string, unknown>;
      if (backup.automatico !== undefined) c.backup.automatico = Boolean(backup.automatico);
      if (numero(backup.intervaloHoras) !== undefined) c.backup.intervaloHoras = Math.max(1, numero(backup.intervaloHoras) as number);
      if (numero(backup.manter) !== undefined) c.backup.manter = Math.max(1, Math.round(numero(backup.manter) as number));
      app.salvarConfiguracoes();
      return configuracoes(app);
    },
  },
  { metodo: "PUT", caminho: "/api/ia/politica", atender: ({ app, corpo }) => { app.definirPoliticaIA({ preferirLocal: corpo.preferirLocal as boolean | undefined, permitirExternos: corpo.permitirExternos as boolean | undefined }); return configuracoes(app); } },
  { metodo: "GET", caminho: "/api/ia/locais", atender: () => detectarServidoresLocais() },
  {
    metodo: "POST", caminho: "/api/ia/provedores",
    atender: ({ app, corpo }) => {
      const origem = corpo.origem === "local" ? "local" : "externo";
      const config: ConfiguracaoProvedor = {
        id: texto(corpo.id), nome: texto(corpo.nome), tipo: "compativel-openai", origem, urlBase: texto(corpo.urlBase), modelo: texto(corpo.modelo),
        capacidades: (Array.isArray(corpo.capacidades) ? corpo.capacidades : ["texto"]) as Capacidade[], ativo: corpo.ativo !== false, ...(origem === "externo" ? { exigeChave: true } : {}),
      };
      // chave: texto novo guarda; null apaga; ausente mantém a que já estava guardada.
      app.salvarProvedor(config, corpo.chave === null ? null : texto(corpo.chave) ? texto(corpo.chave) : undefined);
      app.fluxo.registrar("sistema", `Provedor de IA "${config.nome || config.id}" salvo (${origem}).`);
      return configuracoes(app);
    },
  },
  { metodo: "DELETE", caminho: "/api/ia/provedores/:id", atender: ({ app, p }) => { app.removerProvedor(p.id); app.fluxo.registrar("sistema", `Provedor de IA "${p.id}" removido.`); return configuracoes(app); } },
  // --- IA local ---------------------------------------------------------------------------------------------
  { metodo: "GET", caminho: "/api/ia/local", atender: ({ app }) => app.iaLocal.estado() },
  {
    metodo: "PUT", caminho: "/api/ia/local",
    atender: ({ app, corpo }) => {
      app.definirIALocal({ ativa: corpo.ativa as boolean | undefined, modelo: corpo.modelo === undefined ? undefined : (texto(corpo.modelo) || null), desligarAposMin: numero(corpo.desligarAposMin) });
      return app.iaLocal.estado();
    },
  },
  {
    metodo: "POST", caminho: "/api/ia/local/instalar",
    atender: ({ app, corpo }) => {
      const modelo = texto(corpo.modelo) || app.configuracoes.ia.local.modelo || null;
      return app.tarefas.iniciar({ tipo: "instalacao-ia-local", titulo: "Instalação da IA local", projetoId: null }, async (informar) => {
        const estado = await app.iaLocal.instalar(modelo, informar);
        app.definirIALocal({ ativa: true, modelo: estado.modelo?.id ?? null });
        app.fluxo.registrar("sistema", `IA local instalada: ${estado.modelo?.nome}.`);
      }).tarefa;
    },
  },
  { metodo: "POST", caminho: "/api/ia/local/cancelar", atender: ({ app }) => { app.iaLocal.cancelarInstalacao(); } },
  {
    metodo: "POST", caminho: "/api/ia/local/testar",
    atender: ({ app }) => {
      semTrabalhoEmAndamento(app, "testar a IA local");
      return app.tarefas.iniciar({ tipo: "instalacao-ia-local", titulo: "Teste da IA local", projetoId: null }, async (informar) => {
        const r = await app.iaLocal.testar(informar);
        if (!r.enxergou) throw new Error(`A IA local respondeu, mas não reconheceu a imagem de teste (resposta: ${r.imagem.trim().slice(0, 120)}).`);
        app.fluxo.registrar("sistema", `IA local testada: respondeu e enxergou a imagem de teste em ${r.segundos} s, ${r.dispositivo === "gpu" ? "na placa de vídeo" : "no processador"}.`);
      }).tarefa;
    },
  },
  {
    metodo: "DELETE", caminho: "/api/ia/local",
    atender: async ({ app }) => {
      semTrabalhoEmAndamento(app, "remover a IA local");
      await app.iaLocal.remover();
      app.fluxo.registrar("sistema", "IA local removida.");
      return app.iaLocal.estado();
    },
  },
  { metodo: "GET", caminho: "/api/backups", atender: ({ app }) => app.copias() },
  { metodo: "POST", caminho: "/api/backups", atender: ({ app }) => { const copia = app.copiaDeSeguranca("manual"); app.fluxo.registrar("sistema", `Cópia de segurança criada: ${copia.nome}.`); return app.copias(); } },
  {
    metodo: "POST", caminho: "/api/backups/restaurar",
    atender: ({ app, corpo }) => {
      semTrabalhoEmAndamento(app, "restaurar uma cópia");
      const anterior = app.restaurar(texto(corpo.nome));
      app.fluxo.registrar("sistema", `Cópia de segurança restaurada: ${texto(corpo.nome)}. O estado anterior ficou em ${anterior.nome}.`);
      return { anterior, copias: app.copias() };
    },
  },
];
