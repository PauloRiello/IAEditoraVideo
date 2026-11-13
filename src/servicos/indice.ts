// Índice de pesquisa dos vídeos brutos: cada entrada aponta um trecho de um arquivo
// (cena, fala, momento de ação, silêncio ou problema) com texto e etiquetas.

import type { EntradaDoIndice, ResultadoDaPesquisa } from "../dominio/producao.ts";
import { transacao, type Banco } from "../infra/banco.ts";

/** Minúsculas e sem acentos, para que "ação" encontre "acao" e vice-versa. */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export class ServicoIndice {
  private banco: Banco;

  constructor(banco: Banco) {
    this.banco = banco;
  }

  /** Substitui todas as entradas de uma mídia. */
  gravar(midiaId: string, projetoId: string, entradas: EntradaDoIndice[]): void {
    transacao(this.banco, () => {
      this.banco.prepare("DELETE FROM indice WHERE midia_id = ?").run(midiaId);
      const inserir = this.banco.prepare(
        "INSERT INTO indice (midia_id, projeto_id, tipo, inicio_seg, fim_seg, texto, etiquetas, busca, pontuacao) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const e of entradas) {
        const busca = normalizar(` ${e.tipo} ${e.texto} ${e.etiquetas.join(" ")} `);
        inserir.run(midiaId, projetoId, e.tipo, e.inicioSeg, e.fimSeg, e.texto, JSON.stringify(e.etiquetas), busca, e.pontuacao);
      }
    });
  }

  /**
   * Pesquisa por palavras, assuntos, acontecimentos ou características. Todas as palavras
   * da consulta precisam aparecer no texto ou nas etiquetas do trecho. Os trechos mais
   * relevantes vêm primeiro.
   */
  pesquisar(consulta: string, filtros: { projetoId?: string; tipo?: EntradaDoIndice["tipo"]; limite?: number } = {}): ResultadoDaPesquisa[] {
    const termos = normalizar(consulta).split(/\s+/).filter(Boolean);
    if (termos.length === 0) return [];
    const condicoes = termos.map(() => "i.busca LIKE ? ESCAPE '\\'");
    const valores: (string | number)[] = termos.map((termo) => `%${termo.replace(/[\\%_]/g, "\\$&")}%`);
    if (filtros.projetoId) { condicoes.push("i.projeto_id = ?"); valores.push(filtros.projetoId); }
    if (filtros.tipo) { condicoes.push("i.tipo = ?"); valores.push(filtros.tipo); }
    const linhas = this.banco
      .prepare(
        `SELECT i.*, m.caminho FROM indice i JOIN midias m ON m.id = i.midia_id
         WHERE ${condicoes.join(" AND ")} ORDER BY i.pontuacao DESC, m.caminho, i.inicio_seg LIMIT ?`,
      )
      .all(...valores, filtros.limite ?? 50) as unknown as {
      midia_id: string; projeto_id: string; tipo: EntradaDoIndice["tipo"]; inicio_seg: number; fim_seg: number; texto: string;
      etiquetas: string; pontuacao: number; caminho: string;
    }[];
    return linhas.map((l) => ({
      midiaId: l.midia_id, projetoId: l.projeto_id, arquivo: l.caminho, tipo: l.tipo, inicioSeg: l.inicio_seg, fimSeg: l.fim_seg,
      texto: l.texto, etiquetas: JSON.parse(l.etiquetas) as string[], pontuacao: l.pontuacao,
    }));
  }
}
