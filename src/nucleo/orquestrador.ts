// Orquestrador do pipeline: executa as etapas em ordem, grava cada resultado no banco
// e permite refazer uma etapa sem repetir as anteriores.

import type { EventEmitter } from "node:events";
import { ORDEM_ETAPAS, type EtapaId, type EtapaPipeline } from "../dominio/pipeline.ts";
import type { Perfil, Projeto } from "../dominio/tipos.ts";
import { agora, type Banco } from "../infra/banco.ts";

export interface ExecucaoEtapa {
  etapa: EtapaId;
  estado: "concluida" | "falhou";
  resultado?: unknown;
  erro?: string;
}

export class Orquestrador {
  private etapas = new Map<EtapaId, EtapaPipeline>();
  private banco: Banco;
  private eventos: EventEmitter;

  constructor(banco: Banco, eventos: EventEmitter) {
    this.banco = banco;
    this.eventos = eventos;
  }

  /** Passa a usar outra conexão (depois de uma restauração). As etapas registradas são mantidas. */
  usarBanco(banco: Banco): void {
    this.banco = banco;
  }

  /**
   * Marca como falhas as execuções que ficaram "executando" porque a aplicação foi
   * fechada à força ou o computador desligou. Devolve quantas foram encontradas.
   */
  recuperarInterrompidas(): number {
    return Number(
      this.banco
        .prepare("UPDATE execucoes SET estado = 'falhou', erro = 'Interrompida por fechamento inesperado', concluido_em = ? WHERE estado = 'executando'")
        .run(agora()).changes,
    );
  }

  registrar(etapa: EtapaPipeline): void {
    this.etapas.set(etapa.id, etapa);
  }

  /** Etapas registradas, na ordem do pipeline. */
  registradas(): EtapaId[] {
    return ORDEM_ETAPAS.filter((id) => this.etapas.has(id));
  }

  /** Último resultado concluído de cada etapa do projeto. */
  resultados(projetoId: string): Partial<Record<EtapaId, unknown>> {
    const linhas = this.banco
      .prepare("SELECT etapa, resultado FROM execucoes WHERE projeto_id = ? AND estado = 'concluida' ORDER BY id")
      .all(projetoId) as unknown as { etapa: EtapaId; resultado: string | null }[];
    const resultados: Partial<Record<EtapaId, unknown>> = {};
    for (const linha of linhas) resultados[linha.etapa] = linha.resultado ? JSON.parse(linha.resultado) : null;
    return resultados;
  }

  /**
   * Executa as etapas registradas entre `de` e `ate` (inclusive). Para na primeira falha.
   * Etapas fora do intervalo não são refeitas: seus resultados vêm do banco.
   */
  async executar(projeto: Projeto, perfil: Perfil, intervalo: { de?: EtapaId; ate?: EtapaId } = {}): Promise<ExecucaoEtapa[]> {
    const inicio = intervalo.de ? ORDEM_ETAPAS.indexOf(intervalo.de) : 0;
    const fim = intervalo.ate ? ORDEM_ETAPAS.indexOf(intervalo.ate) : ORDEM_ETAPAS.length - 1;
    const execucoes: ExecucaoEtapa[] = [];

    for (const id of ORDEM_ETAPAS.slice(inicio, fim + 1)) {
      const etapa = this.etapas.get(id);
      if (!etapa) continue;

      const registro = this.banco
        .prepare("INSERT INTO execucoes (projeto_id, etapa, estado, iniciado_em) VALUES (?, ?, 'executando', ?)")
        .run(projeto.id, id, agora());
      this.eventos.emit("etapa:iniciada", { projetoId: projeto.id, etapa: id });

      try {
        const resultado = await etapa.executar({ projeto, perfil, resultados: this.resultados(projeto.id) });
        this.banco
          .prepare("UPDATE execucoes SET estado = 'concluida', resultado = ?, concluido_em = ? WHERE id = ?")
          .run(JSON.stringify(resultado ?? null), agora(), registro.lastInsertRowid);
        execucoes.push({ etapa: id, estado: "concluida", resultado });
        this.eventos.emit("etapa:concluida", { projetoId: projeto.id, etapa: id });
      } catch (erro) {
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        this.banco
          .prepare("UPDATE execucoes SET estado = 'falhou', erro = ?, concluido_em = ? WHERE id = ?")
          .run(mensagem, agora(), registro.lastInsertRowid);
        execucoes.push({ etapa: id, estado: "falhou", erro: mensagem });
        this.eventos.emit("etapa:falhou", { projetoId: projeto.id, etapa: id, erro: mensagem });
        break;
      }
    }
    return execucoes;
  }
}
