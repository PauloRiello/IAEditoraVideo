// Perfis de especialização, lidos de arquivos JSON. Acrescentar um nicho novo
// (por exemplo, outro jogo ou outro tipo de conteúdo) é acrescentar um arquivo.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { NaoEncontrado } from "../dominio/erros.ts";
import type { FormatoSaida, Perfil } from "../dominio/tipos.ts";

export class ServicoPerfis {
  private perfis = new Map<string, Perfil>();

  /** Lê uma ou mais pastas. Em ids repetidos, a pasta posterior prevalece (perfis do usuário sobre os do programa). */
  constructor(pastas: string[]) {
    for (const pasta of pastas) {
      if (!existsSync(pasta)) continue;
      for (const arquivo of readdirSync(pasta).filter((nome) => nome.endsWith(".json")).sort()) {
        const perfil = JSON.parse(readFileSync(path.join(pasta, arquivo), "utf8")) as Perfil;
        this.perfis.set(perfil.id, perfil);
      }
    }
  }

  listar(): Perfil[] {
    return [...this.perfis.values()];
  }

  obter(id: string): Perfil {
    const perfil = this.perfis.get(id);
    if (!perfil) throw new NaoEncontrado("Perfil", id);
    return perfil;
  }

  /**
   * Combina perfis a pedido. A ordem importa: o primeiro define o formato padrão.
   * Formatos são unidos e as diretrizes ficam identificadas pelo perfil de origem, sem
   * fusão automática; pontos em que os perfis divergem voltam em `divergencias`.
   */
  combinar(ids: string[]): { perfil: Perfil; divergencias: string[] } {
    const perfis = ids.map((id) => this.obter(id));
    if (perfis.length === 0) throw new Error("Informe ao menos um perfil.");
    const formatos = new Map<string, FormatoSaida>();
    for (const perfil of perfis) for (const formato of perfil.formatos) if (!formatos.has(formato.id)) formatos.set(formato.id, formato);

    const divergencias: string[] = [];
    const padroes = new Set(perfis.map((p) => p.formatoPadrao));
    if (padroes.size > 1) {
      divergencias.push(
        `Formato padrão diferente entre os perfis (${perfis.map((p) => `${p.id}: ${p.formatoPadrao}`).join(", ")}); usado o de "${perfis[0].id}".`,
      );
    }
    return {
      perfil: {
        id: ids.join("+"),
        nome: perfis.map((p) => p.nome).join(" + "),
        descricao: perfis.map((p) => p.descricao).join(" "),
        formatoPadrao: perfis[0].formatoPadrao,
        formatos: [...formatos.values()],
        diretrizes: perfis.flatMap((p) => p.diretrizes.map((d) => (perfis.length > 1 ? `[${p.id}] ${d}` : d))),
      },
      divergencias,
    };
  }

  formato(perfilId: string, formatoId?: string): FormatoSaida {
    const perfil = this.obter(perfilId);
    const id = formatoId ?? perfil.formatoPadrao;
    const formato = perfil.formatos.find((f) => f.id === id);
    if (!formato) throw new NaoEncontrado("Formato", id);
    return formato;
  }
}
