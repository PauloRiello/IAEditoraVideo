// Feedback e aprendizado contínuo: o usuário avalia uma edição, marca trechos, compara
// versões e informa resultados; a aplicação transforma isso em evidências de aprendizado,
// sempre rastreáveis e reversíveis. Nada aqui depende de serviço externo.

import { ErroAplicacao, NaoEncontrado } from "../dominio/erros.ts";
import {
  ASPECTOS,
  type Aspecto, type Avaliacao, type Comparacao, type DecisaoDaAvaliacao, type LeituraDoResultado, type Metricas, type PainelDeAprendizado,
  type Resultado, type TrechoEmRevisao,
} from "../dominio/feedback.ts";
import type { Aprendizado, Observacao } from "../dominio/memoria.ts";
import { agora, transacao, type Banco } from "../infra/banco.ts";
import type { ServicoAprendizado } from "../servicos/aprendizado.ts";
import { compararTimelines, deduzirCorrecoes } from "../servicos/comparacao.ts";
import type { ServicoProjetos } from "../servicos/projetos.ts";
import type { ServicoTimeline } from "../servicos/timeline.ts";

export interface PedidoDeAvaliacao {
  decisao: DecisaoDaAvaliacao;
  /** Por que a edição foi aprovada ou recusada. Obrigatório ao rejeitar ou pedir alterações. */
  motivo?: string;
  /** Notas de 1 a 5 para roteiro, ritmo, cortes, efeitos, áudio e resultado. */
  notas?: Partial<Record<Aspecto, number>>;
  /** Versão da timeline avaliada. Por padrão, a atual. */
  versao?: number;
  exportacaoId?: number;
  /** Trechos específicos que precisam de revisão. */
  trechos?: { inicioSeg: number; fimSeg: number; itemId?: string; aspecto?: Aspecto; comentario: string }[];
  /** Preferências que o usuário quer registrar explicitamente junto com a avaliação. */
  correcoes?: Pick<Observacao, "categoria" | "chave" | "descricao" | "valor" | "contexto">[];
}

export interface AvaliacaoRegistrada extends Avaliacao {
  /** O que esta avaliação ensinou. */
  aprendizado: { correcoes: Aprendizado[]; confirmados: number; contestados: number };
}

export interface PedidoDeResultado {
  plataforma: string;
  metricas: Metricas;
  exportacaoId?: number;
  evidenciaDeAtribuicao?: string;
  observacoes?: string;
}

interface LinhaAvaliacao {
  id: number; projeto_id: string; versao_da_timeline: number; exportacao_id: number | null; decisao: DecisaoDaAvaliacao; motivo: string; notas: string;
  desfeita: number; criado_em: string;
}
interface LinhaTrecho {
  id: number; avaliacao_id: number; projeto_id: string; inicio_seg: number; fim_seg: number; item_id: string | null; aspecto: Aspecto | null; comentario: string; resolvido: number;
}
interface LinhaResultado {
  id: number; projeto_id: string; exportacao_id: number | null; plataforma: string; metricas: string; evidencia_de_atribuicao: string; observacoes: string; leitura: string; criado_em: string;
}

const paraTrecho = (l: LinhaTrecho): TrechoEmRevisao => ({
  id: l.id, avaliacaoId: l.avaliacao_id, projetoId: l.projeto_id, inicioSeg: l.inicio_seg, fimSeg: l.fim_seg, itemId: l.item_id, aspecto: l.aspecto,
  comentario: l.comentario, resolvido: l.resolvido === 1,
});
const paraResultado = (l: LinhaResultado): Resultado => ({
  id: l.id, projetoId: l.projeto_id, exportacaoId: l.exportacao_id, plataforma: l.plataforma, metricas: JSON.parse(l.metricas), evidenciaDeAtribuicao: l.evidencia_de_atribuicao,
  observacoes: l.observacoes, leitura: JSON.parse(l.leitura), criadoEm: l.criado_em,
});

const CAMPOS_DE_METRICA: (keyof Metricas)[] = [
  "visualizacoes", "retencaoPercentual", "tempoAssistidoSeg", "compartilhamentos", "comentarios", "curtidas", "cliques", "conversoes", "entradasNoDiscord", "novosJogadores",
];
/** Quantos resultados comparáveis são necessários antes de tirar qualquer sinal das métricas. */
const MINIMO_DE_COMPARAVEIS = 3;
/** Variação relativa, em relação à mediana, a partir da qual o resultado conta como acima ou abaixo. */
const VARIACAO_RELEVANTE = 0.25;
/** Peso de um sinal vindo de métricas: metade do de uma avaliação direta do usuário. */
const PESO_DA_METRICA = 0.5;

export interface DependenciasDoFeedback {
  banco: Banco;
  projetos: ServicoProjetos;
  aprendizado: ServicoAprendizado;
  timelines: ServicoTimeline;
}

export class Feedback {
  private d: DependenciasDoFeedback;

  constructor(dependencias: DependenciasDoFeedback) {
    this.d = dependencias;
  }

  // --- Avaliação de uma edição --------------------------------------------------------

  /**
   * Registra a avaliação do usuário sobre uma versão da edição e aprende com ela:
   * - aprovada: as correções manuais (diferença entre a versão da IA e a aprovada) valem para o
   *   projeto e ficam como candidatas no perfil; os aprendizados aplicados ganham uma confirmação;
   * - nota de 1 ou 2 em um aspecto: os aprendizados aplicados daquele aspecto são contestados;
   * - rejeição sem aspecto apontado: fica registrada, mas não ensina nada específico.
   */
  avaliar(projetoId: string, pedido: PedidoDeAvaliacao): AvaliacaoRegistrada {
    const projeto = this.d.projetos.obter(projetoId);
    const versao = this.d.timelines.obter(projetoId, pedido.versao);
    const motivo = (pedido.motivo ?? "").trim();
    if (pedido.decisao !== "aprovada" && !motivo) throw new ErroAplicacao("motivo-obrigatorio", "Informe o motivo ao rejeitar uma edição ou pedir alterações.");
    const notas = pedido.notas ?? {};
    for (const [aspecto, nota] of Object.entries(notas)) {
      if (!(aspecto in ASPECTOS)) throw new ErroAplicacao("aspecto-desconhecido", `Aspecto desconhecido: "${aspecto}".`);
      if (!Number.isInteger(nota) || (nota as number) < 1 || (nota as number) > 5) throw new ErroAplicacao("nota-invalida", `A nota de "${aspecto}" precisa ser um inteiro de 1 a 5.`);
    }
    for (const trecho of pedido.trechos ?? []) {
      if (!(trecho.fimSeg > trecho.inicioSeg) || trecho.inicioSeg < 0) throw new ErroAplicacao("trecho-invalido", "Cada trecho precisa de início e fim válidos.");
    }

    const id = transacao(this.d.banco, () => {
      const r = this.d.banco
        .prepare("INSERT INTO avaliacoes (projeto_id, versao_da_timeline, exportacao_id, decisao, motivo, notas, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(projetoId, versao.versao, pedido.exportacaoId ?? null, pedido.decisao, motivo, JSON.stringify(notas), agora());
      const avaliacaoId = Number(r.lastInsertRowid);
      const inserir = this.d.banco.prepare("INSERT INTO trechos_em_revisao (avaliacao_id, projeto_id, inicio_seg, fim_seg, item_id, aspecto, comentario) VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (const t of pedido.trechos ?? []) inserir.run(avaliacaoId, projetoId, t.inicioSeg, t.fimSeg, t.itemId ?? null, t.aspecto ?? null, t.comentario);
      return avaliacaoId;
    });

    // Aprendizados em vigor no projeto antes desta avaliação: são eles que a edição aplicou.
    const aplicados = this.d.aprendizado.consultar({ projetoId, perfis: [projeto.perfil] }).aplicaveis;
    const detalhe = `Avaliação da edição v${versao.versao}: ${pedido.decisao}${motivo ? ` — ${motivo}` : ""}`;
    const correcoes: Aprendizado[] = [];
    const registrar = (c: Pick<Observacao, "categoria" | "chave" | "descricao" | "valor" | "contexto">) =>
      correcoes.push(this.d.aprendizado.registrarCorrecao(projetoId, { ...c, avaliacaoId: id, detalhe }).doProjeto);

    // Correções manuais: só de uma edição aprovada, comparando com a última versão montada pela IA.
    if (pedido.decisao === "aprovada" && versao.autor === "usuario") {
      const daIA = this.d.timelines.historico(projetoId).filter((v) => v.autor === "ia" && v.versao < versao.versao).at(-1);
      if (daIA) for (const c of deduzirCorrecoes(daIA.timeline, versao.timeline)) registrar(c);
    }
    for (const c of pedido.correcoes ?? []) registrar(c);

    // Confirmação e contestação dos aprendizados aplicados, aspecto por aspecto.
    const corrigidos = new Set(correcoes.map((c) => `${c.categoria}/${c.chave}`));
    let confirmados = 0, contestados = 0;
    for (const aprendizado of aplicados) {
      if (corrigidos.has(`${aprendizado.categoria}/${aprendizado.chave}`)) continue;
      const aspecto = (Object.keys(ASPECTOS) as Aspecto[]).find((a) => ASPECTOS[a].includes(aprendizado.categoria));
      const nota = aspecto ? notas[aspecto] : undefined;
      const sinal = { origem: "feedback" as const, projetoObservado: projetoId, avaliacaoId: id, detalhe: `${detalhe}${nota ? ` (nota ${nota} em ${aspecto})` : ""}` };
      if (nota !== undefined ? nota >= 4 : pedido.decisao === "aprovada") {
        this.d.aprendizado.confirmar(aprendizado.id, sinal);
        confirmados += 1;
      } else if (nota !== undefined && nota <= 2) {
        this.d.aprendizado.contradizer(aprendizado.id, sinal);
        contestados += 1;
      }
    }
    return { ...this.avaliacao(id), aprendizado: { correcoes, confirmados, contestados } };
  }

  avaliacao(id: number): Avaliacao {
    const linha = this.d.banco.prepare("SELECT * FROM avaliacoes WHERE id = ?").get(id) as unknown as LinhaAvaliacao | undefined;
    if (!linha) throw new NaoEncontrado("Avaliação", String(id));
    const trechos = this.d.banco.prepare("SELECT * FROM trechos_em_revisao WHERE avaliacao_id = ? ORDER BY inicio_seg").all(id) as unknown as LinhaTrecho[];
    return {
      id: linha.id, projetoId: linha.projeto_id, versaoDaTimeline: linha.versao_da_timeline, exportacaoId: linha.exportacao_id, decisao: linha.decisao, motivo: linha.motivo,
      notas: JSON.parse(linha.notas), trechos: trechos.map(paraTrecho), desfeita: linha.desfeita === 1, criadoEm: linha.criado_em,
    };
  }

  /** Avaliações de um projeto, da mais recente para a mais antiga. */
  avaliacoes(projetoId: string): Avaliacao[] {
    const ids = this.d.banco.prepare("SELECT id FROM avaliacoes WHERE projeto_id = ? ORDER BY id DESC").all(projetoId) as unknown as { id: number }[];
    return ids.map(({ id }) => this.avaliacao(id));
  }

  /** Desfaz o que uma avaliação ensinou. A avaliação continua no histórico, marcada como desfeita. */
  desfazerAvaliacao(id: number): { aprendizadosAfetados: number } {
    const avaliacao = this.avaliacao(id);
    if (avaliacao.desfeita) throw new ErroAplicacao("avaliacao-ja-desfeita", "O aprendizado desta avaliação já foi desfeito.");
    const aprendizadosAfetados = this.d.aprendizado.esquecerAvaliacao(id);
    this.d.banco.prepare("UPDATE avaliacoes SET desfeita = 1 WHERE id = ?").run(id);
    return { aprendizadosAfetados };
  }

  /** Trechos marcados para revisão em um projeto. */
  trechosEmRevisao(projetoId: string, somentePendentes = true): TrechoEmRevisao[] {
    const linhas = this.d.banco
      .prepare("SELECT * FROM trechos_em_revisao WHERE projeto_id = ? AND (? = 0 OR resolvido = 0) ORDER BY inicio_seg")
      .all(projetoId, somentePendentes ? 1 : 0) as unknown as LinhaTrecho[];
    return linhas.map(paraTrecho);
  }

  resolverTrecho(id: number, resolvido = true): void {
    const r = this.d.banco.prepare("UPDATE trechos_em_revisao SET resolvido = ? WHERE id = ?").run(resolvido ? 1 : 0, id);
    if (Number(r.changes) === 0) throw new NaoEncontrado("Trecho em revisão", String(id));
  }

  // --- Comparação de versões ------------------------------------------------------------

  /** Compara duas versões da timeline. Sem números, compara a anterior com a atual. */
  compararVersoes(projetoId: string, de?: number, para?: number): Comparacao {
    const atual = this.d.timelines.obter(projetoId, para);
    const anterior = this.d.timelines.obter(projetoId, de ?? Math.max(1, atual.versao - 1));
    return compararTimelines(projetoId, anterior, atual);
  }

  // --- O que foi aprendido ---------------------------------------------------------------

  /** Tudo o que a aplicação aprendeu, separado por contexto: geral, perfis, projetos e orientações temporárias. */
  painel(): PainelDeAprendizado {
    const painel: PainelDeAprendizado = { geral: [], perfis: {}, projetos: {}, temporarias: [] };
    for (const a of this.d.aprendizado.listar()) {
      if (a.escopo === "geral") painel.geral.push(a);
      else if (a.escopo === "especializacao") (painel.perfis[a.perfil as string] ??= []).push(a);
      else if (a.escopo === "projeto") (painel.projetos[a.projetoId as string] ??= []).push(a);
      else painel.temporarias.push(a);
    }
    return painel;
  }

  /** Estilo aprendido de um perfil: para cada assunto, a preferência em vigor e a força dela. */
  perfilAprendido(perfilId: string): Record<string, { valor: unknown; confianca: number; evidencias: number; fontes: number; aprendizadoId: number }> {
    const ativos = this.d.aprendizado.consultar({ perfis: [perfilId] }).aplicaveis.filter((a) => a.escopo === "especializacao");
    return Object.fromEntries(
      ativos.map((a) => [`${a.categoria}/${a.chave}`, { valor: a.valor, confianca: a.confianca, evidencias: a.evidencias, fontes: a.projetosObservados, aprendizadoId: a.id }]),
    );
  }

  // --- Métricas de resultado --------------------------------------------------------------

  /**
   * Registra métricas informadas pelo usuário. Elas só viram sinal de aprendizado quando há
   * resultados anteriores suficientes do mesmo perfil e plataforma para comparar, e mesmo
   * então pesam pouco: um bom número pode ter muitas causas além da edição.
   */
  registrarResultado(projetoId: string, pedido: PedidoDeResultado): Resultado {
    const projeto = this.d.projetos.obter(projetoId);
    const plataforma = pedido.plataforma.trim();
    if (!plataforma) throw new ErroAplicacao("plataforma-obrigatoria", "Informe a plataforma em que o vídeo foi publicado.");
    const metricas: Metricas = {};
    for (const campo of CAMPOS_DE_METRICA) {
      const valor = pedido.metricas[campo];
      if (valor === undefined || valor === null) continue;
      if (typeof valor !== "number" || !Number.isFinite(valor) || valor < 0) throw new ErroAplicacao("metrica-invalida", `A métrica "${campo}" precisa ser um número maior ou igual a zero.`);
      metricas[campo] = valor;
    }
    const desconhecidas = Object.keys(pedido.metricas).filter((campo) => !CAMPOS_DE_METRICA.includes(campo as keyof Metricas));
    if (desconhecidas.length) throw new ErroAplicacao("metrica-desconhecida", `Métrica desconhecida: ${desconhecidas.join(", ")}.`);
    if (Object.keys(metricas).length === 0) throw new ErroAplicacao("sem-metricas", "Informe ao menos uma métrica.");
    if ((metricas.retencaoPercentual ?? 0) > 100) throw new ErroAplicacao("metrica-invalida", "A retenção é um percentual de 0 a 100.");
    const evidencia = (pedido.evidenciaDeAtribuicao ?? "").trim();
    if (metricas.novosJogadores !== undefined && !evidencia) {
      throw new ErroAplicacao("atribuicao-sem-evidencia", "Novos jogadores só podem ser atribuídos à campanha com a evidência de como isso foi apurado.");
    }

    const leitura = this.lerResultado(projetoId, projeto.perfil, plataforma, metricas);
    const r = this.d.banco
      .prepare("INSERT INTO resultados (projeto_id, exportacao_id, plataforma, metricas, evidencia_de_atribuicao, observacoes, leitura, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(projetoId, pedido.exportacaoId ?? null, plataforma, JSON.stringify(metricas), evidencia, pedido.observacoes ?? "", JSON.stringify(leitura), agora());
    const id = Number(r.lastInsertRowid);

    // Sinal fraco para os aprendizados em vigor no projeto, só quando o resultado se destaca.
    if (leitura.sinal === "acima" || leitura.sinal === "abaixo") {
      const aplicados = this.d.aprendizado.consultar({ projetoId, perfis: [projeto.perfil] }).aplicaveis;
      const sinal = {
        origem: "feedback" as const, projetoObservado: projetoId, resultadoId: id, peso: PESO_DA_METRICA,
        detalhe: `Resultado em ${plataforma}: ${leitura.metrica} ${leitura.sinal} da mediana dos vídeos comparáveis (correlação, não causa comprovada)`,
      };
      for (const a of aplicados) leitura.sinal === "acima" ? this.d.aprendizado.confirmar(a.id, sinal) : this.d.aprendizado.contradizer(a.id, sinal);
      leitura.aprendizadosSinalizados = aplicados.length;
      this.d.banco.prepare("UPDATE resultados SET leitura = ? WHERE id = ?").run(JSON.stringify(leitura), id);
    }
    return this.resultado(id);
  }

  /** Compara o resultado com os anteriores do mesmo perfil e plataforma. Não usa números absolutos de audiência. */
  private lerResultado(projetoId: string, perfil: string, plataforma: string, metricas: Metricas): LeituraDoResultado {
    const engajamento = (m: Metricas) =>
      m.visualizacoes && m.visualizacoes > 0 && (m.curtidas !== undefined || m.comentarios !== undefined || m.compartilhamentos !== undefined)
        ? ((m.curtidas ?? 0) + (m.comentarios ?? 0) + (m.compartilhamentos ?? 0)) / m.visualizacoes
        : undefined;
    const metrica = metricas.retencaoPercentual !== undefined ? "retencaoPercentual" : engajamento(metricas) !== undefined ? "engajamento" : null;
    const valorDe = (m: Metricas) => (metrica === "retencaoPercentual" ? m.retencaoPercentual : engajamento(m));
    const base: LeituraDoResultado = { sinal: "insuficiente", metrica, valor: null, referencia: null, comparaveis: 0, aprendizadosSinalizados: 0, observacao: "" };
    if (!metrica) {
      return { ...base, observacao: "Números absolutos (visualizações, cliques, entradas) dependem de alcance e divulgação: ficam registrados, mas não são usados como sinal sobre a edição." };
    }
    const anteriores = (this.d.banco
      .prepare(
        `SELECT r.metricas FROM resultados r JOIN projetos p ON p.id = r.projeto_id
         WHERE p.perfil = ? AND LOWER(r.plataforma) = LOWER(?) AND r.projeto_id <> ?`,
      )
      .all(perfil, plataforma, projetoId) as unknown as { metricas: string }[])
      .map((l) => valorDe(JSON.parse(l.metricas) as Metricas))
      .filter((v): v is number => v !== undefined)
      .sort((a, b) => a - b);
    const valor = Math.round((valorDe(metricas) as number) * 10000) / 10000;
    if (anteriores.length < MINIMO_DE_COMPARAVEIS) {
      return {
        ...base, valor, comparaveis: anteriores.length,
        observacao: `Há ${anteriores.length} resultado(s) comparável(is) do mesmo perfil e plataforma; são necessários ${MINIMO_DE_COMPARAVEIS} para qualquer comparação. Nada foi aprendido com este número.`,
      };
    }
    const meio = anteriores.length >> 1;
    const referencia = Math.round((anteriores.length % 2 ? anteriores[meio] : (anteriores[meio - 1] + anteriores[meio]) / 2) * 10000) / 10000;
    const variacao = referencia > 0 ? (valor - referencia) / referencia : 0;
    const sinal = variacao >= VARIACAO_RELEVANTE ? "acima" : variacao <= -VARIACAO_RELEVANTE ? "abaixo" : "dentro";
    return {
      ...base, sinal, valor, referencia, comparaveis: anteriores.length,
      observacao:
        `Comparado com a mediana de ${anteriores.length} vídeos do mesmo perfil e plataforma (${Math.round(variacao * 100)}%). ` +
        "Isso indica correlação, não prova que a edição causou o resultado: tema, horário, divulgação e alcance também pesam. Resultados passados não garantem desempenho futuro.",
    };
  }

  resultado(id: number): Resultado {
    const linha = this.d.banco.prepare("SELECT * FROM resultados WHERE id = ?").get(id) as unknown as LinhaResultado | undefined;
    if (!linha) throw new NaoEncontrado("Resultado", String(id));
    return paraResultado(linha);
  }

  /** Resultados registrados, de um projeto ou de todos. */
  resultados(projetoId?: string): Resultado[] {
    const linhas = this.d.banco
      .prepare("SELECT * FROM resultados WHERE (? IS NULL OR projeto_id = ?) ORDER BY id DESC")
      .all(projetoId ?? null, projetoId ?? null) as unknown as LinhaResultado[];
    return linhas.map(paraResultado);
  }

  /** Remove um resultado e o sinal que ele deu aos aprendizados. */
  removerResultado(id: number): void {
    this.resultado(id);
    this.d.aprendizado.esquecerResultado(id);
    this.d.banco.prepare("DELETE FROM resultados WHERE id = ?").run(id);
  }
}
