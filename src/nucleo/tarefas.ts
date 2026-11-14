// Tarefas em segundo plano: análises e transcrições rodam uma por vez, com estado e
// progresso, sem travar a interface. Os renders têm fila própria (edicao.ts) e aparecem
// aqui espelhados, para que o painel mostre todo o processamento em um só lugar.
// As tarefas vivem só na memória: o que elas produzem é gravado no banco pelos serviços.

import type { EventEmitter } from "node:events";
import type { Exportacao } from "../dominio/timeline.ts";
import type { Tarefa } from "../dominio/tipos.ts";
import { agora } from "../infra/banco.ts";

export interface TarefaIniciada {
  tarefa: Tarefa;
  /** Resolve quando a tarefa termina, com sucesso ou falha. Nunca rejeita. */
  conclusao: Promise<Tarefa>;
}

type Informar = (etapa: string, progresso?: number | null) => void;

const LIMITE = 60;

export class Tarefas {
  private lista: Tarefa[] = [];
  private fila: Promise<unknown> = Promise.resolve();
  private contador = 0;
  private eventos: EventEmitter;

  constructor(eventos: EventEmitter, nomeDoProjeto: (projetoId: string) => string) {
    this.eventos = eventos;
    eventos.on("render:atualizado", (e: Exportacao) => {
      const emAndamento = e.estado === "na-fila" || e.estado === "renderizando";
      this.espelhar(e, {
        titulo: `${e.tipo === "previa" ? "Prévia" : "Exportação"} de ${nomeDoProjeto(e.projetoId)} (timeline v${e.versaoDaTimeline})`,
        estado: e.estado === "renderizando" ? "executando" : e.estado, progresso: emAndamento ? e.progresso : null,
        etapa: e.estado === "na-fila" ? "Na fila" : e.estado === "renderizando" ? "Renderizando" : "", erro: e.erro, concluidaEm: e.concluidoEm,
      });
    });
    eventos.on("render:progresso", (p: { id: number; fase: string; progresso: number }) => {
      const fases: Record<string, string> = { preparando: "Preparando os trechos", renderizando: "Renderizando", conferindo: "Conferindo o arquivo" };
      const tarefa = this.lista.find((t) => t.id === `render-${p.id}`);
      if (tarefa) this.publicar(Object.assign(tarefa, { progresso: p.progresso, etapa: fases[p.fase] ?? p.fase }));
    });
  }

  private publicar(tarefa: Tarefa): Tarefa {
    this.eventos.emit("tarefa:atualizada", { ...tarefa });
    return tarefa;
  }

  private guardar(tarefa: Tarefa): Tarefa {
    this.lista.unshift(tarefa);
    // Só tarefas terminadas saem da lista quando ela passa do limite.
    while (this.lista.length > LIMITE) {
      let posicao = this.lista.length - 1;
      while (posicao >= 0 && (this.lista[posicao].estado === "na-fila" || this.lista[posicao].estado === "executando")) posicao -= 1;
      if (posicao < 0) break;
      this.lista.splice(posicao, 1);
    }
    return tarefa;
  }

  private espelhar(e: Exportacao, campos: Pick<Tarefa, "titulo" | "estado" | "progresso" | "etapa" | "erro" | "concluidaEm">): void {
    const id = `render-${e.id}`;
    const existente = this.lista.find((t) => t.id === id);
    if (existente) this.publicar(Object.assign(existente, campos));
    else this.publicar(this.guardar({ id, tipo: e.tipo === "previa" ? "previa" : "exportacao", projetoId: e.projetoId, criadaEm: e.criadoEm, ...campos }));
  }

  /** Põe um trabalho na fila. Um trabalho roda por vez, na ordem de chegada. */
  iniciar(dados: Pick<Tarefa, "tipo" | "titulo" | "projetoId">, trabalho: (informar: Informar) => Promise<unknown>): TarefaIniciada {
    this.contador += 1;
    const tarefa = this.guardar({ id: `tarefa-${this.contador}`, ...dados, estado: "na-fila", progresso: null, etapa: "Na fila", erro: null, criadaEm: agora(), concluidaEm: null });
    this.publicar(tarefa);
    const informar: Informar = (etapa, progresso = null) => { this.publicar(Object.assign(tarefa, { etapa, progresso })); };
    const conclusao = this.fila.then(async () => {
      this.publicar(Object.assign(tarefa, { estado: "executando", etapa: "Iniciando" }));
      try {
        await trabalho(informar);
        Object.assign(tarefa, { estado: "concluida", progresso: 1, etapa: "" });
      } catch (erro) {
        Object.assign(tarefa, { estado: "falhou", etapa: "", erro: erro instanceof Error ? erro.message : String(erro) });
      }
      return this.publicar(Object.assign(tarefa, { concluidaEm: agora() }));
    });
    this.fila = conclusao;
    return { tarefa, conclusao };
  }

  /** Tarefas mais recentes primeiro. */
  listar(): Tarefa[] {
    return this.lista.map((t) => ({ ...t }));
  }

  emAndamento(): Tarefa[] {
    return this.listar().filter((t) => t.estado === "na-fila" || t.estado === "executando");
  }

  /** Espera as tarefas da fila terminarem (os renders são esperados por `edicao.cancelarTudo`). */
  async aguardar(): Promise<void> {
    await this.fila;
  }
}
