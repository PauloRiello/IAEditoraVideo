// Aprendizado controlado. Cada aprendizado guarda de onde veio, em quais projetos foi
// observado, quantas evidências tem e a confiança. Uma observação isolada fica como
// "candidato": só passa a valer para outros projetos depois de se repetir.

import { ErroAplicacao, NaoEncontrado } from "../dominio/erros.ts";
import type { AcaoDeAprendizado } from "../dominio/feedback.ts";
import {
  CATEGORIAS_EDICAO, PROJETOS_PARA_ATIVAR,
  type Aprendizado, type CategoriaEdicao, type Conflito, type ConsultaAprendizados, type EscopoAprendizado,
  type EstadoAprendizado, type Evidencia, type Observacao,
} from "../dominio/memoria.ts";
import type { Feedback } from "../dominio/tipos.ts";
import { agora, transacao, type Banco } from "../infra/banco.ts";

interface Linha {
  id: number; escopo: EscopoAprendizado; perfil: string | null; projeto_id: string | null; categoria: CategoriaEdicao;
  chave: string; descricao: string; valor: string; contexto: string; estado: EstadoAprendizado; confianca: number;
  evidencias: number; contrarias: number; projetos_observados: number; expira_em: string | null;
  criado_em: string; atualizado_em: string;
}

const paraAprendizado = (l: Linha): Aprendizado => ({
  id: l.id, escopo: l.escopo, perfil: l.perfil, projetoId: l.projeto_id, categoria: l.categoria, chave: l.chave,
  descricao: l.descricao, valor: JSON.parse(l.valor), contexto: l.contexto, estado: l.estado, confianca: l.confianca,
  evidencias: l.evidencias, contrarias: l.contrarias, projetosObservados: l.projetos_observados, expiraEm: l.expira_em,
  criadoEm: l.criado_em, atualizadoEm: l.atualizado_em,
});

/** Uma instrução explícita do usuário pesa mais que uma observação. */
const PESO = { usuario: 3, correcao: 1, feedback: 1, analise: 1 } as const;

/** Do mais específico para o mais amplo: o mais específico prevalece. */
const PRECEDENCIA: Record<EscopoAprendizado, number> = { temporaria: 4, projeto: 3, especializacao: 2, geral: 1 };

/** Evidência a favor ou contra um aprendizado existente, com a fonte que a gerou. */
export interface SinalDeEvidencia {
  origem: Observacao["origem"];
  projetoObservado?: string;
  detalhe?: string;
  avaliacaoId?: number;
  resultadoId?: number;
  /** Peso da evidência; por padrão, o da origem. Sinais de métricas usam peso menor. */
  peso?: number;
}

export interface FiltroAprendizados {
  escopo?: EscopoAprendizado;
  perfil?: string;
  projetoId?: string;
  categoria?: CategoriaEdicao;
  estado?: EstadoAprendizado;
}

export class ServicoAprendizado {
  private banco: Banco;

  constructor(banco: Banco) {
    this.banco = banco;
  }

  // --- Feedback --------------------------------------------------------------

  registrarFeedback(projetoId: string, nota: number, comentario: string): Feedback {
    const criadoEm = agora();
    const r = this.banco
      .prepare("INSERT INTO feedback (projeto_id, nota, comentario, criado_em) VALUES (?, ?, ?, ?)")
      .run(projetoId, nota, comentario, criadoEm);
    return { id: Number(r.lastInsertRowid), projetoId, nota, comentario, criadoEm };
  }

  feedbacks(projetoId?: string): Feedback[] {
    const linhas = this.banco
      .prepare("SELECT * FROM feedback WHERE (? IS NULL OR projeto_id = ?) ORDER BY id")
      .all(projetoId ?? null, projetoId ?? null) as unknown as { id: number; projeto_id: string; nota: number; comentario: string; criado_em: string }[];
    return linhas.map((l) => ({ id: l.id, projetoId: l.projeto_id, nota: l.nota, comentario: l.comentario, criadoEm: l.criado_em }));
  }

  // --- Registro de aprendizados ----------------------------------------------

  /**
   * Registra uma observação. Se já existe um aprendizado igual (mesmo dono, assunto e
   * valor), soma uma evidência; senão cria um candidato. Aprendizados do mesmo dono e
   * assunto com valor diferente recebem uma evidência contrária.
   */
  observar(o: Observacao): Aprendizado {
    if (!CATEGORIAS_EDICAO.includes(o.categoria)) throw new Error(`Categoria desconhecida: "${o.categoria}".`);
    if (!o.chave.trim() || !o.descricao.trim()) throw new Error("O aprendizado precisa de chave e descrição.");
    if (o.escopo === "especializacao" && !o.perfil) throw new Error("Aprendizado de especialização precisa de um perfil.");
    if (o.escopo === "projeto" && !o.projetoId) throw new Error("Aprendizado de projeto precisa de um projeto.");

    const perfil = o.escopo === "especializacao" ? (o.perfil as string) : null;
    const projetoId = o.escopo === "projeto" || o.escopo === "temporaria" ? (o.projetoId ?? null) : null;
    const valor = JSON.stringify(o.valor ?? null);
    const observadoEm = o.projetoObservado ?? o.projetoId ?? null;
    const instante = agora();
    const dono = [o.escopo, perfil ?? "", projetoId ?? "", o.categoria, o.chave] as const;
    const DONO = "escopo = ? AND COALESCE(perfil, '') = ? AND COALESCE(projeto_id, '') = ? AND categoria = ? AND chave = ?";

    const id = transacao(this.banco, () => {
      const existente = this.banco.prepare(`SELECT id FROM aprendizados WHERE ${DONO} AND valor = ?`).get(...dono, valor) as
        | { id: number }
        | undefined;
      const alvo =
        existente?.id ??
        Number(
          this.banco
            .prepare(
              `INSERT INTO aprendizados (escopo, perfil, projeto_id, categoria, chave, descricao, valor, contexto, estado, expira_em, criado_em, atualizado_em)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'candidato', ?, ?, ?)`,
            )
            .run(o.escopo, perfil, projetoId, o.categoria, o.chave, o.descricao, valor, o.contexto ?? "", o.expiraEm ?? null, instante, instante)
            .lastInsertRowid,
        );

      const referencia = o.referenciaObservada ?? null;
      const evidencia = this.banco.prepare(
        "INSERT INTO evidencias (aprendizado_id, origem, projeto_id, referencia_id, avaliacao_id, feedback_id, detalhe, confirma, peso, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      const avaliacao = o.avaliacaoId ?? null;
      evidencia.run(alvo, o.origem, observadoEm, referencia, avaliacao, o.feedbackId ?? null, o.detalhe ?? "", 1, PESO[o.origem], instante);

      const rivais = this.banco.prepare(`SELECT id FROM aprendizados WHERE ${DONO} AND valor <> ?`).all(...dono, valor) as unknown as { id: number }[];
      for (const rival of rivais) {
        evidencia.run(rival.id, o.origem, observadoEm, referencia, avaliacao, o.feedbackId ?? null, `Observado valor diferente: ${o.descricao}`, 0, PESO[o.origem], instante);
        this.reavaliar(rival.id);
      }
      this.reavaliar(alvo);
      return alvo;
    });
    return this.obter(id);
  }

  /**
   * Registra uma correção feita em um projeto. Ela vale imediatamente para esse projeto
   * e fica como candidata no perfil dele: só se torna regra do perfil quando a mesma
   * correção aparecer em outro projeto. Nunca vira regra geral por este caminho.
   */
  registrarCorrecao(
    projetoId: string,
    dados: Pick<Observacao, "categoria" | "chave" | "descricao" | "valor" | "contexto" | "detalhe" | "feedbackId" | "avaliacaoId">,
  ): { doProjeto: Aprendizado; daEspecializacao: Aprendizado } {
    const projeto = this.banco.prepare("SELECT perfil FROM projetos WHERE id = ?").get(projetoId) as { perfil: string } | undefined;
    if (!projeto) throw new NaoEncontrado("Projeto", projetoId);
    const doProjeto = this.observar({ ...dados, escopo: "projeto", projetoId, origem: "correcao" });
    const daEspecializacao = this.observar({
      ...dados, escopo: "especializacao", perfil: projeto.perfil, projetoObservado: projetoId, origem: "correcao",
    });
    return { doProjeto, daEspecializacao };
  }

  /** Registra que um aprendizado não se confirmou em uma situação. */
  contradizer(id: number, dados: SinalDeEvidencia): Aprendizado {
    return this.avaliar(id, 0, dados);
  }

  /** Registra que um aprendizado se confirmou (por exemplo, o usuário aprovou um plano que o aplicava). */
  confirmar(id: number, dados: SinalDeEvidencia): Aprendizado {
    return this.avaliar(id, 1, dados);
  }

  private avaliar(id: number, confirma: 0 | 1, dados: SinalDeEvidencia): Aprendizado {
    this.obter(id);
    this.banco
      .prepare("INSERT INTO evidencias (aprendizado_id, origem, projeto_id, avaliacao_id, resultado_id, detalhe, confirma, peso, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, dados.origem, dados.projetoObservado ?? null, dados.avaliacaoId ?? null, dados.resultadoId ?? null, dados.detalhe ?? "", confirma, dados.peso ?? PESO[dados.origem], agora());
    this.reavaliar(id);
    return this.obter(id);
  }

  /**
   * Remove tudo o que uma referência havia ensinado, para que analisá-la de novo não conte
   * em dobro. Aprendizados que ficarem sem nenhuma evidência são excluídos.
   */
  esquecerReferencia(referenciaId: string): void {
    this.esquecerFonte("referencia_id", referenciaId);
  }

  /** Desfaz o que uma avaliação do usuário ensinou. Devolve quantos aprendizados foram afetados. */
  esquecerAvaliacao(avaliacaoId: number): number {
    return this.esquecerFonte("avaliacao_id", avaliacaoId);
  }

  /** Desfaz o sinal que um resultado publicado deu aos aprendizados. */
  esquecerResultado(resultadoId: number): number {
    return this.esquecerFonte("resultado_id", resultadoId);
  }

  private esquecerFonte(coluna: "referencia_id" | "avaliacao_id" | "resultado_id", valor: string | number): number {
    return transacao(this.banco, () => {
      const afetados = this.banco.prepare(`SELECT DISTINCT aprendizado_id AS id FROM evidencias WHERE ${coluna} = ?`).all(valor) as unknown as { id: number }[];
      this.banco.prepare(`DELETE FROM evidencias WHERE ${coluna} = ?`).run(valor);
      for (const { id } of afetados) {
        const restam = this.banco.prepare("SELECT COUNT(*) AS n FROM evidencias WHERE aprendizado_id = ?").get(id) as { n: number };
        if (restam.n === 0) this.banco.prepare("DELETE FROM aprendizados WHERE id = ?").run(id);
        else this.reavaliar(id);
      }
      return afetados.length;
    });
  }

  /** Recalcula evidências, confiança e estado a partir das evidências gravadas. */
  private reavaliar(id: number): void {
    const s = this.banco
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN confirma = 1 THEN peso END), 0) AS favor,
                COALESCE(SUM(CASE WHEN confirma = 0 THEN peso END), 0) AS contra,
                COALESCE(SUM(confirma), 0) AS confirmam,
                COUNT(*) - COALESCE(SUM(confirma), 0) AS contradizem,
                COUNT(DISTINCT CASE WHEN confirma = 1 AND resultado_id IS NULL THEN COALESCE(projeto_id, 'ref:' || referencia_id) END) AS projetos,
                COALESCE(MAX(CASE WHEN confirma = 1 AND origem = 'usuario' THEN 1 ELSE 0 END), 0) AS explicito
         FROM evidencias WHERE aprendizado_id = ?`,
      )
      .get(id) as { favor: number; contra: number; confirmam: number; contradizem: number; projetos: number; explicito: number };
    const atual = this.banco.prepare("SELECT escopo, estado FROM aprendizados WHERE id = ?").get(id) as {
      escopo: EscopoAprendizado;
      estado: EstadoAprendizado;
    };

    // Sinais vindos de métricas de resultado (resultado_id) pesam na confiança, mas não contam como
    // fonte distinta: números de audiência, sozinhos, nunca promovem um candidato a regra.
    // Confiança cresce com as evidências e nunca chega a 1: uma evidência = 0,33; três = 0,6.
    const confianca = Math.round((s.favor / (s.favor + s.contra + 2)) * 100) / 100;
    const suficiente =
      s.explicito === 1 ||
      atual.escopo === "projeto" ||
      atual.escopo === "temporaria" ||
      s.projetos >= PROJETOS_PARA_ATIVAR[atual.escopo as "especializacao" | "geral"];
    // Um aprendizado desativado pelo usuário continua desativado, por mais evidências que receba.
    const estado: EstadoAprendizado = atual.estado === "desativado" ? "desativado" : suficiente && s.favor > s.contra ? "ativo" : "candidato";

    this.banco
      .prepare("UPDATE aprendizados SET confianca = ?, evidencias = ?, contrarias = ?, projetos_observados = ?, estado = ?, atualizado_em = ? WHERE id = ?")
      .run(confianca, s.confirmam, s.contradizem, s.projetos, estado, agora(), id);
  }

  // --- Revisão ----------------------------------------------------------------

  obter(id: number): Aprendizado {
    const linha = this.banco.prepare("SELECT * FROM aprendizados WHERE id = ?").get(id) as unknown as Linha | undefined;
    if (!linha) throw new NaoEncontrado("Aprendizado", String(id));
    return paraAprendizado(linha);
  }

  /** Histórico de onde o aprendizado veio. */
  evidencias(id: number): Evidencia[] {
    const linhas = this.banco.prepare("SELECT * FROM evidencias WHERE aprendizado_id = ? ORDER BY id").all(id) as unknown as {
      id: number; aprendizado_id: number; origem: Evidencia["origem"]; projeto_id: string | null; referencia_id: string | null;
      avaliacao_id: number | null; resultado_id: number | null; feedback_id: number | null;
      detalhe: string; confirma: number; peso: number; criado_em: string;
    }[];
    return linhas.map((l) => ({
      id: l.id, aprendizadoId: l.aprendizado_id, origem: l.origem, projetoId: l.projeto_id, referenciaId: l.referencia_id,
      avaliacaoId: l.avaliacao_id, resultadoId: l.resultado_id, feedbackId: l.feedback_id,
      detalhe: l.detalhe, confirma: l.confirma === 1, peso: l.peso, criadoEm: l.criado_em,
    }));
  }

  listar(filtro: FiltroAprendizados = {}): Aprendizado[] {
    const condicoes: string[] = [];
    const valores: string[] = [];
    const colunas = { escopo: "escopo", perfil: "perfil", projetoId: "projeto_id", categoria: "categoria", estado: "estado" } as const;
    for (const [campo, coluna] of Object.entries(colunas) as [keyof FiltroAprendizados, string][]) {
      const valor = filtro[campo];
      if (valor !== undefined) {
        condicoes.push(`${coluna} = ?`);
        valores.push(valor);
      }
    }
    const onde = condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : "";
    const linhas = this.banco.prepare(`SELECT * FROM aprendizados ${onde} ORDER BY categoria, chave, id`).all(...valores) as unknown as Linha[];
    return linhas.map(paraAprendizado);
  }

  /** Corrige o texto, o valor, o contexto ou a categoria de um aprendizado. */
  corrigir(id: number, campos: Partial<Pick<Aprendizado, "descricao" | "valor" | "contexto" | "categoria">>): Aprendizado {
    const atual = this.obter(id);
    const categoria = campos.categoria ?? atual.categoria;
    if (!CATEGORIAS_EDICAO.includes(categoria)) throw new Error(`Categoria desconhecida: "${categoria}".`);
    this.registrarAcao(id, "corrigido");
    this.banco
      .prepare("UPDATE aprendizados SET descricao = ?, valor = ?, contexto = ?, categoria = ?, atualizado_em = ? WHERE id = ?")
      .run(
        campos.descricao ?? atual.descricao,
        JSON.stringify("valor" in campos ? (campos.valor ?? null) : atual.valor),
        campos.contexto ?? atual.contexto,
        categoria,
        agora(),
        id,
      );
    return this.obter(id);
  }

  /** Desativa: o aprendizado deixa de ser aplicado, mas continua guardado. */
  desativar(id: number): Aprendizado {
    this.obter(id);
    this.registrarAcao(id, "desativado");
    this.banco.prepare("UPDATE aprendizados SET estado = 'desativado', atualizado_em = ? WHERE id = ?").run(agora(), id);
    return this.obter(id);
  }

  /** Ativa por decisão do usuário, mesmo sem evidências suficientes. Fica registrado como instrução explícita. */
  ativar(id: number): Aprendizado {
    this.obter(id);
    this.registrarAcao(id, "ativado");
    transacao(this.banco, () => {
      this.banco.prepare("UPDATE aprendizados SET estado = 'candidato' WHERE id = ?").run(id);
      this.banco
        .prepare("INSERT INTO evidencias (aprendizado_id, origem, detalhe, confirma, peso, criado_em) VALUES (?, 'usuario', 'Ativado pelo usuário', 1, ?, ?)")
        .run(id, PESO.usuario, agora());
      this.reavaliar(id);
    });
    return this.obter(id);
  }

  excluir(id: number): void {
    this.obter(id);
    this.registrarAcao(id, "excluido");
    this.banco.prepare("DELETE FROM aprendizados WHERE id = ?").run(id);
  }

  // --- Reversibilidade ----------------------------------------------------------

  /** Guarda o estado completo do aprendizado (com suas evidências) antes de uma ação do usuário. */
  private registrarAcao(id: number, acao: AcaoDeAprendizado["acao"]): void {
    const aprendizado = this.banco.prepare("SELECT * FROM aprendizados WHERE id = ?").get(id) as Record<string, unknown>;
    const evidencias = this.banco.prepare("SELECT * FROM evidencias WHERE aprendizado_id = ? ORDER BY id").all(id);
    this.banco
      .prepare("INSERT INTO acoes_de_aprendizado (aprendizado_id, acao, descricao, estado_anterior, criado_em) VALUES (?, ?, ?, ?, ?)")
      .run(id, acao, `${aprendizado.categoria}/${aprendizado.chave}: ${aprendizado.descricao}`, JSON.stringify({ aprendizado, evidencias }), agora());
  }

  /** Ações do usuário sobre aprendizados (correções, desativações, ativações, exclusões), da mais recente para a mais antiga. */
  acoes(aprendizadoId?: number): AcaoDeAprendizado[] {
    const linhas = this.banco
      .prepare("SELECT id, aprendizado_id, acao, descricao, desfeita, criado_em FROM acoes_de_aprendizado WHERE (? IS NULL OR aprendizado_id = ?) ORDER BY id DESC")
      .all(aprendizadoId ?? null, aprendizadoId ?? null) as unknown as { id: number; aprendizado_id: number; acao: AcaoDeAprendizado["acao"]; descricao: string; desfeita: number; criado_em: string }[];
    return linhas.map((l) => ({ id: l.id, aprendizadoId: l.aprendizado_id, acao: l.acao, descricao: l.descricao, desfeita: l.desfeita === 1, criadoEm: l.criado_em }));
  }

  /** Desfaz uma ação: o aprendizado volta exatamente ao estado anterior, com as evidências que tinha. */
  desfazerAcao(acaoId: number): Aprendizado {
    const acao = this.banco.prepare("SELECT * FROM acoes_de_aprendizado WHERE id = ?").get(acaoId) as
      | { aprendizado_id: number; estado_anterior: string; desfeita: number }
      | undefined;
    if (!acao) throw new NaoEncontrado("Ação de aprendizado", String(acaoId));
    if (acao.desfeita) throw new ErroAplicacao("acao-ja-desfeita", "Esta ação já foi desfeita.");
    const { aprendizado, evidencias } = JSON.parse(acao.estado_anterior) as { aprendizado: Record<string, unknown>; evidencias: Record<string, unknown>[] };
    const existe = (tabela: string, id: unknown) => id === null || id === undefined || Boolean(this.banco.prepare(`SELECT 1 FROM ${tabela} WHERE id = ?`).get(id as string | number));
    if (!existe("projetos", aprendizado.projeto_id)) throw new ErroAplicacao("projeto-removido", "O projeto deste aprendizado não existe mais.");

    const inserir = (tabela: string, linha: Record<string, unknown>) => {
      const colunas = Object.keys(linha);
      this.banco
        .prepare(`INSERT INTO ${tabela} (${colunas.join(", ")}) VALUES (${colunas.map(() => "?").join(", ")})`)
        .run(...colunas.map((c) => linha[c] as string | number | null));
    };
    transacao(this.banco, () => {
      this.banco.prepare("DELETE FROM aprendizados WHERE id = ?").run(acao.aprendizado_id);
      inserir("aprendizados", aprendizado);
      for (const evidencia of evidencias) {
        // Fontes que deixaram de existir (projeto, referência, avaliação, resultado) ficam sem vínculo.
        const fontes = { projeto_id: "projetos", referencia_id: "referencias", avaliacao_id: "avaliacoes", resultado_id: "resultados", feedback_id: "feedback" };
        for (const [coluna, tabela] of Object.entries(fontes)) if (!existe(tabela, evidencia[coluna])) evidencia[coluna] = null;
        inserir("evidencias", evidencia);
      }
      this.banco.prepare("UPDATE acoes_de_aprendizado SET desfeita = 1 WHERE id = ?").run(acaoId);
    });
    return this.obter(acao.aprendizado_id);
  }

  /** Remove orientações temporárias vencidas. Devolve quantas foram removidas. */
  limparExpirados(): number {
    return Number(
      this.banco.prepare("DELETE FROM aprendizados WHERE escopo = 'temporaria' AND expira_em IS NOT NULL AND expira_em <= ?").run(agora()).changes,
    );
  }

  // --- Consulta para uso na edição -------------------------------------------

  /**
   * Aprendizados ativos que valem para um projeto e um conjunto de perfis.
   * Para cada assunto prevalece o mais específico: temporária > projeto > especialização > geral.
   * Quando perfis combinados discordam sobre um assunto, nada é aplicado e o caso volta em
   * `conflitos` — a menos que `resolverPorOrdem` peça para o primeiro perfil da lista prevalecer.
   */
  consultar(pedido: { projetoId?: string; perfis?: string[]; categoria?: CategoriaEdicao; resolverPorOrdem?: boolean }): ConsultaAprendizados {
    const perfis = pedido.perfis ?? [];
    const ativos = this.listar({ estado: "ativo", categoria: pedido.categoria }).filter((a) => {
      if (a.expiraEm && a.expiraEm <= agora()) return false;
      if (a.escopo === "geral") return true;
      if (a.escopo === "especializacao") return perfis.includes(a.perfil as string);
      if (a.escopo === "projeto") return a.projetoId === pedido.projetoId;
      return a.projetoId === null || a.projetoId === pedido.projetoId;
    });

    const grupos = new Map<string, Aprendizado[]>();
    for (const a of ativos) {
      const assunto = `${a.categoria}\u0000${a.chave}`;
      grupos.set(assunto, [...(grupos.get(assunto) ?? []), a]);
    }

    const melhor = (lista: Aprendizado[]) =>
      [...lista].sort((x, y) => y.confianca - x.confianca || y.atualizadoEm.localeCompare(x.atualizadoEm))[0];
    const aplicaveis: Aprendizado[] = [];
    const conflitos: Conflito[] = [];

    for (const grupo of grupos.values()) {
      const nivel = Math.max(...grupo.map((a) => PRECEDENCIA[a.escopo]));
      const noNivel = grupo.filter((a) => PRECEDENCIA[a.escopo] === nivel);

      if (noNivel[0].escopo !== "especializacao") {
        aplicaveis.push(melhor(noNivel));
        continue;
      }
      // Um representante por perfil; perfis diferentes com valores diferentes são incompatíveis.
      const porPerfil = perfis
        .map((perfil) => noNivel.filter((a) => a.perfil === perfil))
        .filter((lista) => lista.length > 0)
        .map(melhor);
      const valores = new Set(porPerfil.map((a) => JSON.stringify(a.valor)));
      if (valores.size === 1 || pedido.resolverPorOrdem) aplicaveis.push(valores.size === 1 ? melhor(porPerfil) : porPerfil[0]);
      else conflitos.push({ categoria: porPerfil[0].categoria, chave: porPerfil[0].chave, opcoes: porPerfil });
    }

    const ordem = (a: { categoria: string; chave: string }, b: { categoria: string; chave: string }) =>
      a.categoria.localeCompare(b.categoria) || a.chave.localeCompare(b.chave);
    return { aplicaveis: aplicaveis.sort(ordem), conflitos: conflitos.sort(ordem) };
  }
}
