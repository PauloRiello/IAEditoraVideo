// Edição da timeline. Cada operação devolve uma timeline nova — a anterior não é alterada —
// e cada versão salva fica no histórico. Os arquivos de mídia nunca são tocados.

import { ErroAplicacao, NaoEncontrado } from "../dominio/erros.ts";
import type { Exportacao, ItemDaTimeline, Operacao, Timeline, VersaoDaTimeline } from "../dominio/timeline.ts";
import { agora, transacao, type Banco } from "../infra/banco.ts";

type Principal = Extract<ItemDaTimeline, { tipo: "video" | "imagem" | "cartao" }>;
const arredondar = (n: number) => Math.round(n * 1000) / 1000;
const invalida = (mensagem: string) => new ErroAplicacao("timeline-invalida", mensagem);

/** Itens da faixa principal (camada 0), na ordem em que aparecem. */
export function faixaPrincipal(timeline: Timeline): Principal[] {
  return timeline.itens
    .filter((i): i is Principal => i.camada === 0 && (i.tipo === "video" || i.tipo === "imagem" || i.tipo === "cartao"))
    .sort((a, b) => a.inicioSeg - b.inicioSeg);
}

/**
 * Reorganiza a timeline depois de uma mudança: encosta os clipes da faixa principal uns nos
 * outros (com sobreposição nas transições graduais), reposiciona os itens ancorados e
 * recalcula a duração total.
 */
function refluir(timeline: Timeline, ordem = faixaPrincipal(timeline)): Timeline {
  let tempo = 0;
  ordem.forEach((item, i) => {
    const anterior = ordem[i - 1];
    const sobreposicao = anterior && item.entrada.tipo === "gradual" ? Math.min(item.entrada.duracaoSeg, anterior.duracaoSeg / 2, item.duracaoSeg / 2) : 0;
    item.inicioSeg = arredondar(tempo - sobreposicao);
    tempo = item.inicioSeg + item.duracaoSeg;
  });

  const porId = new Map(timeline.itens.map((i) => [i.id, i]));
  timeline.itens = timeline.itens.filter((item) => {
    if (!item.ancora) return true;
    const ancora = porId.get(item.ancora.itemId);
    // Legenda de um clipe removido (ou de um trecho cortado fora) sai junto; outros itens ficam soltos.
    if (!ancora || item.ancora.deslocamentoSeg >= ancora.duracaoSeg || item.ancora.deslocamentoSeg + item.duracaoSeg <= 0) {
      if (item.tipo === "legenda") return false;
      delete item.ancora;
      return true;
    }
    const deslocamento = Math.max(0, item.ancora.deslocamentoSeg);
    item.duracaoSeg = arredondar(Math.min(item.duracaoSeg + Math.min(0, item.ancora.deslocamentoSeg), ancora.duracaoSeg - deslocamento));
    item.ancora.deslocamentoSeg = deslocamento;
    item.inicioSeg = arredondar(ancora.inicioSeg + deslocamento);
    return true;
  });

  const fimDosClipes = ordem.length ? Math.max(...ordem.map((i) => i.inicioSeg + i.duracaoSeg)) : 0;
  timeline.duracaoSeg = arredondar(fimDosClipes || Math.max(0, ...timeline.itens.map((i) => i.inicioSeg + i.duracaoSeg)));
  // A trilha não passa do fim do vídeo.
  for (const item of timeline.itens) {
    if (item.tipo === "audio" && item.papel === "trilha") item.duracaoSeg = arredondar(Math.max(0.1, Math.min(item.duracaoSeg, timeline.duracaoSeg - item.inicioSeg)));
  }
  return timeline;
}

function validar(timeline: Timeline): Timeline {
  const { largura, altura, fps } = timeline.formato;
  if (largura < 16 || altura < 16 || largura % 2 || altura % 2) throw invalida("A resolução precisa ter largura e altura pares.");
  if (fps < 1 || fps > 120) throw invalida("A taxa de quadros precisa estar entre 1 e 120.");
  const ids = new Set<string>();
  for (const item of timeline.itens) {
    if (!item.id || ids.has(item.id)) throw invalida(`Identificador de item ausente ou repetido: "${item.id}".`);
    ids.add(item.id);
    if (!(item.duracaoSeg > 0) || item.inicioSeg < 0) throw invalida(`O item "${item.id}" tem tempo inválido.`);
    if (item.tipo === "video" && (item.velocidade < 0.1 || item.velocidade > 8)) throw invalida(`Velocidade fora do intervalo de 0,1 a 8 no item "${item.id}".`);
    if ((item.tipo === "video" || item.tipo === "audio") && (item.volume < 0 || item.volume > 2)) throw invalida(`Volume fora do intervalo de 0 a 2 no item "${item.id}".`);
  }
  return timeline;
}

/** Aplica uma operação e devolve a timeline resultante. A timeline recebida não é modificada. */
export function aplicarOperacao(original: Timeline, op: Operacao): Timeline {
  const t = structuredClone(original);
  const obter = (id: string) => {
    const item = t.itens.find((i) => i.id === id);
    if (!item) throw new NaoEncontrado("Item da timeline", id);
    return item;
  };
  const ePrincipal = (item: ItemDaTimeline) => faixaPrincipal(t).some((p) => p.id === item.id);

  switch (op.tipo) {
    case "inserir": {
      const item = structuredClone(op.item);
      if (!item.id) item.id = `item-${t.itens.length + 1}-${Date.now().toString(36)}`;
      t.itens.push(item);
      break;
    }
    case "remover": {
      obter(op.id);
      t.itens = t.itens.filter((i) => i.id !== op.id);
      break;
    }
    case "cortar": {
      const item = obter(op.id);
      const inicio = op.inicioSeg ?? 0, fim = op.fimSeg ?? item.duracaoSeg;
      if (inicio < 0 || fim > item.duracaoSeg + 1e-6 || fim - inicio < 0.1) throw invalida(`Corte inválido no item "${op.id}".`);
      if (item.tipo === "video") item.inicioOrigemSeg = arredondar(item.inicioOrigemSeg + inicio * item.velocidade);
      if (item.tipo === "audio") item.inicioOrigemSeg = arredondar(item.inicioOrigemSeg + inicio);
      if (!ePrincipal(item)) item.inicioSeg = arredondar(item.inicioSeg + inicio);
      item.duracaoSeg = arredondar(fim - inicio);
      for (const outro of t.itens) if (outro.ancora?.itemId === item.id) outro.ancora.deslocamentoSeg = arredondar(outro.ancora.deslocamentoSeg - inicio);
      break;
    }
    case "dividir": {
      const item = obter(op.id);
      if (op.emSeg < 0.1 || op.emSeg > item.duracaoSeg - 0.1) throw invalida(`Ponto de divisão inválido no item "${op.id}".`);
      const segundo = structuredClone(item);
      segundo.id = `${item.id}-b`;
      segundo.inicioSeg = arredondar(item.inicioSeg + op.emSeg);
      segundo.duracaoSeg = arredondar(item.duracaoSeg - op.emSeg);
      delete segundo.ancora;
      if (segundo.tipo === "video") segundo.inicioOrigemSeg = arredondar(segundo.inicioOrigemSeg + op.emSeg * segundo.velocidade);
      if (segundo.tipo === "audio") { segundo.inicioOrigemSeg = arredondar(segundo.inicioOrigemSeg + op.emSeg); segundo.fadeDeEntradaSeg = 0; }
      if ("entrada" in segundo && "saida" in item) { segundo.entrada = { tipo: "corte", duracaoSeg: 0 }; item.saida = { tipo: "corte", duracaoSeg: 0 }; }
      if (item.tipo === "audio") item.fadeDeSaidaSeg = 0;
      item.duracaoSeg = arredondar(op.emSeg);
      // O que estava preso à segunda metade passa a acompanhar o novo item.
      for (const outro of t.itens) {
        if (outro.ancora?.itemId === item.id && outro.ancora.deslocamentoSeg >= op.emSeg) {
          outro.ancora = { itemId: segundo.id, deslocamentoSeg: arredondar(outro.ancora.deslocamentoSeg - op.emSeg) };
        }
      }
      t.itens.push(segundo);
      break;
    }
    case "ajustar-duracao": {
      if (!(op.duracaoSeg >= 0.1)) throw invalida("A duração mínima de um item é 0,1 s.");
      obter(op.id).duracaoSeg = arredondar(op.duracaoSeg);
      break;
    }
    case "reposicionar": {
      const ordem = faixaPrincipal(t);
      const atual = ordem.findIndex((i) => i.id === op.id);
      if (atual < 0) throw invalida(`O item "${op.id}" não está na faixa principal.`);
      const [item] = ordem.splice(atual, 1);
      ordem.splice(Math.max(0, Math.min(ordem.length, op.posicao)), 0, item);
      // O primeiro clipe não tem de onde fazer transição gradual.
      if (ordem[0].entrada.tipo === "gradual") ordem[0].entrada = { tipo: "corte", duracaoSeg: 0 };
      return validar(refluir(t, ordem));
    }
    case "mover": {
      const item = obter(op.id);
      if (ePrincipal(item)) throw invalida("Clipes da faixa principal mudam de lugar com a operação \"reposicionar\".");
      if (op.inicioSeg < 0) throw invalida("O início não pode ser negativo.");
      delete item.ancora;
      item.inicioSeg = arredondar(op.inicioSeg);
      break;
    }
    case "mudar-camada": {
      obter(op.id).camada = op.camada;
      break;
    }
    case "alterar": {
      const item = obter(op.id) as unknown as Record<string, unknown>;
      for (const [campo, valor] of Object.entries(op.campos)) {
        if (["id", "tipo", "inicioSeg", "duracaoSeg", "camada"].includes(campo)) throw invalida(`O campo "${campo}" não é alterado por esta operação.`);
        if (!(campo in item)) throw invalida(`O item "${op.id}" não tem o campo "${campo}".`);
        const atual = item[campo];
        item[campo] = atual && typeof atual === "object" && !Array.isArray(atual) && valor && typeof valor === "object" && !Array.isArray(valor) ? { ...atual, ...valor } : valor;
      }
      break;
    }
    case "efeito-global": {
      t.efeitosGlobais = t.efeitosGlobais.filter((e) => e.tipo !== op.efeito.tipo);
      if (!op.remover) t.efeitosGlobais.push(op.efeito);
      break;
    }
    case "formato": {
      t.formato = { ...t.formato, ...op.formato };
      break;
    }
  }
  return validar(refluir(t));
}

/** Descrição curta de uma operação, para o histórico. */
export function descreverOperacao(op: Operacao): string {
  const alvo = "id" in op ? ` "${op.id}"` : "";
  const nomes: Record<Operacao["tipo"], string> = {
    inserir: "Inserido item", remover: "Removido item", cortar: "Cortado item", dividir: "Dividido item", "ajustar-duracao": "Ajustada a duração de",
    reposicionar: "Reposicionado item", mover: "Movido item", "mudar-camada": "Mudada a camada de", alterar: "Alterado item", "efeito-global": "Alterado efeito global", formato: "Alterado o formato",
  };
  const detalhe = op.tipo === "inserir" ? ` "${op.item.id}" (${op.item.tipo})` : op.tipo === "alterar" ? `: ${Object.keys(op.campos).join(", ")}` : op.tipo === "efeito-global" ? `: ${op.efeito.tipo}` : "";
  return `${nomes[op.tipo]}${alvo}${detalhe}`;
}

interface LinhaTimeline { projeto_id: string; versao: number; timeline: string; autor: "ia" | "usuario"; nota: string; criado_em: string }
interface LinhaExportacao {
  id: number; projeto_id: string; versao_da_timeline: number; tipo: "previa" | "final"; estado: Exportacao["estado"]; progresso: number; arquivo: string | null;
  largura: number | null; altura: number | null; fps: number | null; duracao_seg: number | null; tamanho_bytes: number | null; verificacao: string | null;
  erro: string | null; tentativas: number; criado_em: string; concluido_em: string | null;
}

const paraVersao = (l: LinhaTimeline): VersaoDaTimeline => ({ projetoId: l.projeto_id, versao: l.versao, timeline: JSON.parse(l.timeline), autor: l.autor, nota: l.nota, criadoEm: l.criado_em });
const paraExportacao = (l: LinhaExportacao): Exportacao => ({
  id: l.id, projetoId: l.projeto_id, versaoDaTimeline: l.versao_da_timeline, tipo: l.tipo, estado: l.estado, progresso: l.progresso, arquivo: l.arquivo,
  largura: l.largura, altura: l.altura, fps: l.fps, duracaoSeg: l.duracao_seg, tamanhoBytes: l.tamanho_bytes,
  verificacao: l.verificacao ? JSON.parse(l.verificacao) : null, erro: l.erro, tentativas: l.tentativas, criadoEm: l.criado_em, concluidoEm: l.concluido_em,
});

/** Guarda as versões da timeline e o histórico de exportações. */
export class ServicoTimeline {
  private banco: Banco;

  constructor(banco: Banco) {
    this.banco = banco;
  }

  /** Salva a timeline como nova versão. Versões anteriores nunca são alteradas. */
  salvar(projetoId: string, timeline: Timeline, autor: "ia" | "usuario", nota: string): VersaoDaTimeline {
    return transacao(this.banco, () => {
      const ultima = this.banco.prepare("SELECT COALESCE(MAX(versao), 0) AS v FROM timelines WHERE projeto_id = ?").get(projetoId) as { v: number };
      this.banco
        .prepare("INSERT INTO timelines (projeto_id, versao, timeline, autor, nota, criado_em) VALUES (?, ?, ?, ?, ?, ?)")
        .run(projetoId, ultima.v + 1, JSON.stringify(validar(structuredClone(timeline))), autor, nota, agora());
      return this.obter(projetoId, ultima.v + 1);
    });
  }

  /** Uma versão da timeline; sem número, a mais recente. */
  obter(projetoId: string, versao?: number): VersaoDaTimeline {
    const linha = this.banco
      .prepare("SELECT * FROM timelines WHERE projeto_id = ? AND (? IS NULL OR versao = ?) ORDER BY versao DESC LIMIT 1")
      .get(projetoId, versao ?? null, versao ?? null) as unknown as LinhaTimeline | undefined;
    if (!linha) throw new NaoEncontrado("Timeline", versao ? `${projetoId} v${versao}` : projetoId);
    return paraVersao(linha);
  }

  historico(projetoId: string): VersaoDaTimeline[] {
    return (this.banco.prepare("SELECT * FROM timelines WHERE projeto_id = ? ORDER BY versao").all(projetoId) as unknown as LinhaTimeline[]).map(paraVersao);
  }

  // --- Exportações --------------------------------------------------------------

  criarExportacao(projetoId: string, versaoDaTimeline: number, tipo: "previa" | "final"): Exportacao {
    const r = this.banco
      .prepare("INSERT INTO exportacoes (projeto_id, versao_da_timeline, tipo, estado, criado_em) VALUES (?, ?, ?, 'na-fila', ?)")
      .run(projetoId, versaoDaTimeline, tipo, agora());
    return this.exportacao(Number(r.lastInsertRowid));
  }

  atualizarExportacao(id: number, campos: Partial<Omit<Exportacao, "id" | "projetoId" | "versaoDaTimeline" | "tipo" | "criadoEm">>): Exportacao {
    const colunas: Record<string, string> = {
      estado: "estado", progresso: "progresso", arquivo: "arquivo", largura: "largura", altura: "altura", fps: "fps", duracaoSeg: "duracao_seg",
      tamanhoBytes: "tamanho_bytes", verificacao: "verificacao", erro: "erro", tentativas: "tentativas", concluidoEm: "concluido_em",
    };
    const nomes = Object.keys(campos).filter((campo) => campo in colunas);
    if (nomes.length) {
      const valores = nomes.map((campo) => {
        const valor = (campos as Record<string, unknown>)[campo];
        return (campo === "verificacao" && valor ? JSON.stringify(valor) : (valor ?? null)) as string | number | null;
      });
      this.banco.prepare(`UPDATE exportacoes SET ${nomes.map((campo) => `${colunas[campo]} = ?`).join(", ")} WHERE id = ?`).run(...valores, id);
    }
    return this.exportacao(id);
  }

  exportacao(id: number): Exportacao {
    const linha = this.banco.prepare("SELECT * FROM exportacoes WHERE id = ?").get(id) as unknown as LinhaExportacao | undefined;
    if (!linha) throw new NaoEncontrado("Exportação", String(id));
    return paraExportacao(linha);
  }

  /** Histórico de exportações de um projeto, da mais recente para a mais antiga. */
  exportacoes(projetoId: string): Exportacao[] {
    return (this.banco.prepare("SELECT * FROM exportacoes WHERE projeto_id = ? ORDER BY id DESC").all(projetoId) as unknown as LinhaExportacao[]).map(paraExportacao);
  }

  /** Marca como falhas as exportações que ficaram pela metade quando a aplicação fechou. Devolve quantas eram. */
  recuperarInterrompidas(): number {
    return Number(
      this.banco
        .prepare("UPDATE exportacoes SET estado = 'falhou', erro = 'Interrompida por fechamento da aplicação', concluido_em = ? WHERE estado IN ('na-fila', 'renderizando')")
        .run(agora()).changes,
    );
  }
}
