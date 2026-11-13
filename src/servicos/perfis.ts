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

  formato(perfilId: string, formatoId?: string): FormatoSaida {
    const perfil = this.obter(perfilId);
    const id = formatoId ?? perfil.formatoPadrao;
    const formato = perfil.formatos.find((f) => f.id === id);
    if (!formato) throw new NaoEncontrado("Formato", id);
    return formato;
  }
}
