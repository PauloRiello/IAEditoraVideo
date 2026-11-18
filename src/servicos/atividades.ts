// Histórico de atividades: o que aconteceu na aplicação e em cada projeto, em palavras.

import type { Atividade } from "../dominio/tipos.ts";
import { agora, type Banco } from "../infra/banco.ts";

interface Linha { id: number; projeto_id: string | null; tipo: string; descricao: string; criado_em: string }

const paraAtividade = (l: Linha): Atividade => ({ id: l.id, projetoId: l.projeto_id, tipo: l.tipo, descricao: l.descricao, criadoEm: l.criado_em });

export class ServicoAtividades {
  private banco: Banco;

  constructor(banco: Banco) {
    this.banco = banco;
  }

  registrar(tipo: string, descricao: string, projetoId: string | null = null): Atividade {
    const r = this.banco.prepare("INSERT INTO atividades (projeto_id, tipo, descricao, criado_em) VALUES (?, ?, ?, ?)").run(projetoId, tipo, descricao.slice(0, 500), agora());
    return paraAtividade(this.banco.prepare("SELECT * FROM atividades WHERE id = ?").get(Number(r.lastInsertRowid)) as unknown as Linha);
  }

  /** Atividades mais recentes primeiro, de um projeto ou de toda a aplicação. */
  listar(filtro: { projetoId?: string; limite?: number } = {}): Atividade[] {
    const linhas = this.banco
      .prepare("SELECT * FROM atividades WHERE (? IS NULL OR projeto_id = ?) ORDER BY id DESC LIMIT ?")
      .all(filtro.projetoId ?? null, filtro.projetoId ?? null, filtro.limite ?? 50) as unknown as Linha[];
    return linhas.map(paraAtividade);
  }
}
