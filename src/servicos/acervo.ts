// Acervo de conhecimento dos projetos: referências, análises, planos de edição
// versionados e registro de uso de modelos de IA. Só caminhos, metadados e resultados
// vão para o banco; os arquivos de vídeo ficam onde estão.

import { randomUUID } from "node:crypto";
import { NaoEncontrado } from "../dominio/erros.ts";
import type { Analise, DecisaoRegistrada, Referencia, UsoIA, VersaoPlano } from "../dominio/memoria.ts";
import { agora, transacao, type Banco } from "../infra/banco.ts";

interface LinhaReferencia {
  id: string; titulo: string; caminho: string | null; origem_url: string | null; perfil: string | null;
  autorizacao: string; notas: string; criado_em: string;
}
interface LinhaAnalise { id: number; midia_id: string | null; referencia_id: string | null; tipo: string; resultado: string; criado_em: string }
interface LinhaPlano {
  id: number; projeto_id: string; versao: number; plano: string; autor: "ia" | "usuario"; nota: string;
  estado: VersaoPlano["estado"]; decidido_em: string | null; criado_em: string;
}
interface LinhaUso {
  id: number; projeto_id: string | null; provedor: string; modelo: string; origem: "local" | "externo"; capacidade: string;
  operacao: string; dispositivo: "gpu" | "cpu" | null; duracao_ms: number | null; sucesso: number; criado_em: string;
}

const paraReferencia = (l: LinhaReferencia): Referencia => ({
  id: l.id, titulo: l.titulo, caminho: l.caminho, origemUrl: l.origem_url, perfil: l.perfil,
  autorizacao: l.autorizacao, notas: l.notas, criadoEm: l.criado_em,
});
const paraAnalise = (l: LinhaAnalise): Analise => ({
  id: l.id, midiaId: l.midia_id, referenciaId: l.referencia_id, tipo: l.tipo, resultado: JSON.parse(l.resultado), criadoEm: l.criado_em,
});
const paraPlano = (l: LinhaPlano): VersaoPlano => ({
  id: l.id, projetoId: l.projeto_id, versao: l.versao, plano: JSON.parse(l.plano), autor: l.autor, nota: l.nota,
  estado: l.estado, decididoEm: l.decidido_em, criadoEm: l.criado_em,
});

export class ServicoAcervo {
  private banco: Banco;

  constructor(banco: Banco) {
    this.banco = banco;
  }

  // --- Referências -----------------------------------------------------------

  /** Registra uma referência pelo caminho local ou pelo endereço de origem. O arquivo não é copiado. */
  adicionarReferencia(dados: { titulo: string; caminho?: string; origemUrl?: string; perfil?: string; autorizacao?: string; notas?: string }): Referencia {
    if (!dados.caminho && !dados.origemUrl) throw new Error("A referência precisa de um caminho ou de um endereço de origem.");
    const id = randomUUID();
    this.banco
      .prepare("INSERT INTO referencias (id, titulo, caminho, origem_url, perfil, autorizacao, notas, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, dados.titulo, dados.caminho ?? null, dados.origemUrl ?? null, dados.perfil ?? null, dados.autorizacao ?? "", dados.notas ?? "", agora());
    return this.referencia(id);
  }

  /** Referência já registrada a partir deste endereço (normalizado), ou null. */
  referenciaPorOrigem(url: string): Referencia | null {
    const linha = this.banco.prepare("SELECT id FROM referencias WHERE origem_url = ?").get(url) as { id: string } | undefined;
    return linha ? this.referencia(linha.id) : null;
  }

  referencia(id: string): Referencia {
    const linha = this.banco.prepare("SELECT * FROM referencias WHERE id = ?").get(id) as unknown as LinhaReferencia | undefined;
    if (!linha) throw new NaoEncontrado("Referência", id);
    return paraReferencia(linha);
  }

  vincularReferencia(projetoId: string, referenciaId: string): void {
    this.banco.prepare("INSERT OR IGNORE INTO projeto_referencias (projeto_id, referencia_id) VALUES (?, ?)").run(projetoId, referenciaId);
  }

  /** Todas as referências, ou só as vinculadas a um projeto. */
  referencias(projetoId?: string): Referencia[] {
    const linhas = (projetoId
      ? this.banco
          .prepare("SELECT r.* FROM referencias r JOIN projeto_referencias v ON v.referencia_id = r.id WHERE v.projeto_id = ? ORDER BY r.criado_em")
          .all(projetoId)
      : this.banco.prepare("SELECT * FROM referencias ORDER BY criado_em").all()) as unknown as LinhaReferencia[];
    return linhas.map(paraReferencia);
  }

  /** Remove o registro e suas análises. O arquivo de vídeo não é apagado. */
  removerReferencia(id: string): void {
    this.referencia(id);
    this.banco.prepare("DELETE FROM referencias WHERE id = ?").run(id);
  }

  // --- Análises --------------------------------------------------------------

  /** Guarda o resultado de uma análise de uma mídia do projeto ou de uma referência. */
  registrarAnalise(alvo: { midiaId: string } | { referenciaId: string }, tipo: string, resultado: unknown): Analise {
    const midiaId = "midiaId" in alvo ? alvo.midiaId : null;
    const referenciaId = "referenciaId" in alvo ? alvo.referenciaId : null;
    const r = this.banco
      .prepare("INSERT INTO analises (midia_id, referencia_id, tipo, resultado, criado_em) VALUES (?, ?, ?, ?, ?)")
      .run(midiaId, referenciaId, tipo, JSON.stringify(resultado ?? null), agora());
    return paraAnalise(this.banco.prepare("SELECT * FROM analises WHERE id = ?").get(r.lastInsertRowid) as unknown as LinhaAnalise);
  }

  /** Análises de um alvo, da mais recente para a mais antiga. */
  analises(alvo: { midiaId: string } | { referenciaId: string }, tipo?: string): Analise[] {
    const coluna = "midiaId" in alvo ? "midia_id" : "referencia_id";
    const id = "midiaId" in alvo ? alvo.midiaId : alvo.referenciaId;
    const linhas = this.banco
      .prepare(`SELECT * FROM analises WHERE ${coluna} = ? AND (? IS NULL OR tipo = ?) ORDER BY id DESC`)
      .all(id, tipo ?? null, tipo ?? null) as unknown as LinhaAnalise[];
    return linhas.map(paraAnalise);
  }

  // --- Planos de edição e histórico de versões ---------------------------------

  /** Salva o plano como uma nova versão. Versões anteriores nunca são alteradas. */
  salvarPlano(projetoId: string, plano: unknown, autor: "ia" | "usuario", nota = ""): VersaoPlano {
    return transacao(this.banco, () => {
      const ultima = this.banco.prepare("SELECT COALESCE(MAX(versao), 0) AS v FROM planos WHERE projeto_id = ?").get(projetoId) as { v: number };
      this.banco
        .prepare("INSERT INTO planos (projeto_id, versao, plano, autor, nota, criado_em) VALUES (?, ?, ?, ?, ?, ?)")
        .run(projetoId, ultima.v + 1, JSON.stringify(plano), autor, nota, agora());
      return this.plano(projetoId, ultima.v + 1);
    });
  }

  /** Uma versão do plano; sem número, a mais recente. */
  plano(projetoId: string, versao?: number): VersaoPlano {
    const linha = this.banco
      .prepare("SELECT * FROM planos WHERE projeto_id = ? AND (? IS NULL OR versao = ?) ORDER BY versao DESC LIMIT 1")
      .get(projetoId, versao ?? null, versao ?? null) as unknown as LinhaPlano | undefined;
    if (!linha) throw new NaoEncontrado("Plano", versao ? `${projetoId} v${versao}` : projetoId);
    return paraPlano(linha);
  }

  historicoDePlanos(projetoId: string): VersaoPlano[] {
    const linhas = this.banco.prepare("SELECT * FROM planos WHERE projeto_id = ? ORDER BY versao").all(projetoId) as unknown as LinhaPlano[];
    return linhas.map(paraPlano);
  }

  /** Volta a uma versão anterior criando uma versão nova com o mesmo conteúdo. O histórico é preservado. */
  restaurarPlano(projetoId: string, versao: number): VersaoPlano {
    const antiga = this.plano(projetoId, versao);
    return this.salvarPlano(projetoId, antiga.plano, "usuario", `Restaurado da versão ${versao}`);
  }

  /** Marca uma versão como aprovada ou rejeitada. Aprovar uma versão tira a aprovação das demais. */
  decidirPlano(projetoId: string, versao: number, estado: "aprovado" | "rejeitado"): VersaoPlano {
    this.plano(projetoId, versao);
    transacao(this.banco, () => {
      if (estado === "aprovado") this.banco.prepare("UPDATE planos SET estado = 'rascunho' WHERE projeto_id = ? AND estado = 'aprovado'").run(projetoId);
      this.banco.prepare("UPDATE planos SET estado = ?, decidido_em = ? WHERE projeto_id = ? AND versao = ?").run(estado, agora(), projetoId, versao);
    });
    return this.plano(projetoId, versao);
  }

  /** Versão aprovada do plano, se a mais recente estiver aprovada. Um plano alterado depois precisa de nova aprovação. */
  planoAprovado(projetoId: string): VersaoPlano | null {
    const linha = this.banco.prepare("SELECT * FROM planos WHERE projeto_id = ? ORDER BY versao DESC LIMIT 1").get(projetoId) as unknown as LinhaPlano | undefined;
    return linha && linha.estado === "aprovado" ? paraPlano(linha) : null;
  }

  // --- Decisões e alterações ---------------------------------------------------

  registrarDecisao(projetoId: string, tipo: DecisaoRegistrada["tipo"], descricao: string, versaoDoPlano: number | null = null): void {
    this.banco
      .prepare("INSERT INTO decisoes (projeto_id, versao_do_plano, tipo, descricao, criado_em) VALUES (?, ?, ?, ?, ?)")
      .run(projetoId, versaoDoPlano, tipo, descricao, agora());
  }

  decisoes(projetoId: string): DecisaoRegistrada[] {
    const linhas = this.banco.prepare("SELECT * FROM decisoes WHERE projeto_id = ? ORDER BY id").all(projetoId) as unknown as {
      id: number; projeto_id: string; versao_do_plano: number | null; tipo: DecisaoRegistrada["tipo"]; descricao: string; criado_em: string;
    }[];
    return linhas.map((l) => ({ id: l.id, projetoId: l.projeto_id, versaoDoPlano: l.versao_do_plano, tipo: l.tipo, descricao: l.descricao, criadoEm: l.criado_em }));
  }

  // --- Modelos e provedores utilizados ----------------------------------------

  registrarUsoIA(uso: Omit<UsoIA, "id" | "criadoEm">): void {
    this.banco
      .prepare(
        `INSERT INTO usos_ia (projeto_id, provedor, modelo, origem, capacidade, operacao, dispositivo, duracao_ms, sucesso, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(uso.projetoId, uso.provedor, uso.modelo, uso.origem, uso.capacidade, uso.operacao, uso.dispositivo, uso.duracaoMs, uso.sucesso ? 1 : 0, agora());
  }

  usosIA(projetoId?: string): UsoIA[] {
    const linhas = this.banco
      .prepare("SELECT * FROM usos_ia WHERE (? IS NULL OR projeto_id = ?) ORDER BY id")
      .all(projetoId ?? null, projetoId ?? null) as unknown as LinhaUso[];
    return linhas.map((l) => ({
      id: l.id, projetoId: l.projeto_id, provedor: l.provedor, modelo: l.modelo, origem: l.origem, capacidade: l.capacidade,
      operacao: l.operacao, dispositivo: l.dispositivo, duracaoMs: l.duracao_ms, sucesso: l.sucesso === 1, criadoEm: l.criado_em,
    }));
  }
}
