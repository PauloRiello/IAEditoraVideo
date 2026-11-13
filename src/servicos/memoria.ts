// Memória persistente e aprendizado. Tudo fica no banco local: nada depende de
// histórico de conversa nem de serviço externo.

import type { Feedback } from "../dominio/tipos.ts";
import { agora, type Banco } from "../infra/banco.ts";

/** Guarda fatos duráveis por escopo (por exemplo "preferencias" ou "perfil:fivem"). */
export class ServicoMemoria {
  private banco: Banco;

  constructor(banco: Banco) {
    this.banco = banco;
  }

  lembrar(escopo: string, chave: string, valor: unknown): void {
    this.banco
      .prepare(
        `INSERT INTO memoria (escopo, chave, valor, atualizado_em) VALUES (?, ?, ?, ?)
         ON CONFLICT (escopo, chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em`,
      )
      .run(escopo, chave, JSON.stringify(valor), agora());
  }

  recordar<T>(escopo: string, chave: string): T | undefined {
    const linha = this.banco.prepare("SELECT valor FROM memoria WHERE escopo = ? AND chave = ?").get(escopo, chave) as
      | { valor: string }
      | undefined;
    return linha ? (JSON.parse(linha.valor) as T) : undefined;
  }

  escopo(escopo: string): Record<string, unknown> {
    const linhas = this.banco.prepare("SELECT chave, valor FROM memoria WHERE escopo = ? ORDER BY chave").all(escopo) as unknown as {
      chave: string;
      valor: string;
    }[];
    return Object.fromEntries(linhas.map((l) => [l.chave, JSON.parse(l.valor)]));
  }

  esquecer(escopo: string, chave: string): void {
    this.banco.prepare("DELETE FROM memoria WHERE escopo = ? AND chave = ?").run(escopo, chave);
  }
}

/**
 * Registra o feedback do usuário, matéria-prima do aprendizado.
 * A derivação de padrões a partir do feedback pertence a uma etapa futura.
 */
export class ServicoAprendizado {
  private banco: Banco;

  constructor(banco: Banco) {
    this.banco = banco;
  }

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
}
