// Perfis de qualidade por destino e presets de exportação, lidos de arquivos JSON.
// Os do usuário (pasta de dados) prevalecem sobre os que acompanham o programa.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { NaoEncontrado } from "../dominio/erros.ts";
import type { PerfilDeQualidade, PresetDeExportacao } from "../dominio/qualidade.ts";

function carregar<T extends { id: string }>(pastas: string[]): Map<string, T> {
  const itens = new Map<string, T>();
  for (const pasta of pastas) {
    if (!existsSync(pasta)) continue;
    for (const arquivo of readdirSync(pasta).filter((nome) => nome.endsWith(".json")).sort()) {
      const item = JSON.parse(readFileSync(path.join(pasta, arquivo), "utf8")) as T;
      itens.set(item.id, item);
    }
  }
  return itens;
}

export class ServicoDeQualidade {
  private perfis: Map<string, PerfilDeQualidade>;
  private presets: Map<string, PresetDeExportacao>;

  constructor(pastasDePerfis: string[], pastasDePresets: string[]) {
    this.perfis = carregar<PerfilDeQualidade>(pastasDePerfis);
    this.presets = carregar<PresetDeExportacao>(pastasDePresets);
  }

  listarPerfis(): PerfilDeQualidade[] {
    return [...this.perfis.values()];
  }

  perfil(id: string): PerfilDeQualidade {
    const perfil = this.perfis.get(id);
    if (!perfil) throw new NaoEncontrado("Perfil de qualidade", id);
    return perfil;
  }

  /**
   * Escolhe o perfil de qualidade de um vídeo, nesta ordem: o pedido explicitamente; o que
   * reconhece a plataforma informada no briefing; o de mesmo nome do perfil do projeto; e,
   * por fim, pelo formato — vertical é tratado como rede social, o restante como geral.
   */
  escolherPerfil(contexto: { pedido?: string; plataforma?: string; perfilDoProjeto?: string; vertical: boolean }): PerfilDeQualidade {
    if (contexto.pedido) return this.perfil(contexto.pedido);
    const plataforma = (contexto.plataforma ?? "").toLowerCase();
    const pelaPlataforma = plataforma ? this.listarPerfis().find((p) => p.plataformas.some((palavra) => plataforma.includes(palavra))) : undefined;
    if (pelaPlataforma) return pelaPlataforma;
    if (contexto.perfilDoProjeto && this.perfis.has(contexto.perfilDoProjeto)) return this.perfil(contexto.perfilDoProjeto);
    return this.perfil(contexto.vertical ? "redes-sociais" : "geral");
  }

  listarPresets(): PresetDeExportacao[] {
    return [...this.presets.values()];
  }

  preset(id: string): PresetDeExportacao {
    const preset = this.presets.get(id);
    if (!preset) throw new NaoEncontrado("Preset de exportação", id);
    return preset;
  }
}
