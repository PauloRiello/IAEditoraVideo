// Caso de uso da identidade visual: ler o manual da marca em segundo plano (tarefa com
// porcentagem) e guardar as sugestões para o usuário confirmar. Nada é aplicado aqui.

import path from "node:path";
import { lerManual } from "../../Pipeline/brand/manual.ts";
import { ErroAplicacao } from "../dominio/erros.ts";
import type { ProvedorIA } from "../dominio/provedores.ts";
import { pythonDoAmbiente, type Caminhos } from "../infra/caminhos.ts";
import type { ServicoMarcas } from "../servicos/marcas.ts";
import type { RegistroProvedores } from "../servicos/provedores.ts";
import type { TarefaIniciada, Tarefas } from "./tarefas.ts";

export interface DependenciasDasMarcas {
  caminhos: Caminhos;
  marcas: ServicoMarcas;
  tarefas: Tarefas;
  provedores: Pick<RegistroProvedores, "selecionar">;
  registrar: (descricao: string) => void;
}

/** Pede à IA local (ou outro modelo visual) a ordem das candidatas a logo. */
function perguntarAoModelo(provedor: ProvedorIA): (imagens: string[]) => Promise<number[]> {
  return async (imagens) => {
    const resposta = await provedor.descreverImagens!({
      imagens,
      instrucao: `As ${imagens.length} imagens vieram do manual de uma marca, na ordem 0 a ${imagens.length - 1}. ` +
        'Ordene da mais provável à menos provável de ser o LOGO da marca. Responda somente com JSON: {"ordem": [índices]}.',
    });
    const ordem = (JSON.parse(/\{[\s\S]*\}/.exec(resposta)?.[0] ?? "{}") as { ordem?: unknown }).ordem;
    if (!Array.isArray(ordem)) throw new Error("resposta sem ordem");
    return ordem.map(Number).filter((n) => Number.isInteger(n));
  };
}

export class FluxoDeMarcas {
  private d: DependenciasDasMarcas;

  constructor(d: DependenciasDasMarcas) {
    this.d = d;
  }

  /** Guarda o PDF na marca e lê as sugestões (logo, cores, fontes) numa tarefa com porcentagem. */
  lerManual(marcaId: string, arquivo: string): TarefaIniciada {
    const marca = this.d.marcas.obter(marcaId);
    return this.d.tarefas.iniciar({ tipo: "leitura-de-manual", titulo: `Lendo o manual da marca ${marca.nome}`, projetoId: null }, async (informar) => {
      const python = pythonDoAmbiente(this.d.caminhos);
      if (!python) throw new ErroAplicacao("leitor-de-pdf-ausente", "O leitor de PDF ainda não está instalado. Feche e abra o programa com internet para terminar a preparação, ou cadastre a marca à mão.");
      const copia = this.d.marcas.guardarArquivo(marcaId, arquivo, "material");
      let ia: ((imagens: string[]) => Promise<number[]>) | undefined;
      try {
        const provedor = await this.d.provedores.selecionar("visao");
        if (provedor.descreverImagens) ia = perguntarAoModelo(provedor);
      } catch {
        ia = undefined; // sem modelo visual: só as regras simples escolhem as candidatas
      }
      const pasta = path.join(this.d.marcas.pastaDaMarca(marcaId), `leitura-${path.basename(copia, path.extname(copia))}`);
      const sugestoes = await lerManual(copia, { pasta, python, aoAvancar: informar, ia });
      this.d.marcas.atualizar(marcaId, { sugestoes });
      this.d.registrar(`Manual da marca "${marca.nome}" lido: ${sugestoes.cores.length} cor(es), ${sugestoes.fontes.length} fonte(s) e ${sugestoes.logos.length} candidata(s) a logo para confirmar.`);
      return sugestoes;
    });
  }
}
