// Preferências e fatos duráveis, guardados no banco local por escopo e chave.
// Nada depende de histórico de conversa nem de serviço externo.
// O aprendizado com evidências fica em aprendizado.ts.

import { agora, type Banco } from "../infra/banco.ts";

/** Guarda valores por escopo (por exemplo "preferencias" ou "perfil:fivem"). */
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
