// Estilos de edição: conjuntos de escolhas visuais e de ritmo (gameplay, ação, humor,
// trailer...). São arquivos JSON; qualquer perfil pode usar qualquer estilo, e novos
// estilos entram como novos arquivos.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { NaoEncontrado } from "../dominio/erros.ts";
import type { Efeito, Transicao } from "../dominio/timeline.ts";

export interface EstiloDeEdicao {
  id: string;
  nome: string;
  descricao: string;
  /** Perfis para os quais o estilo foi pensado. Não é uma restrição. */
  indicadoPara: string[];
  duracaoDoPlanoSeg: number;
  transicao: Transicao;
  /** Efeitos que o estilo propõe. A montagem decide, pelo contexto, quais realmente aplicar. */
  efeitos: Efeito[];
  zoomLentoEmPlanosParados: boolean;
  legendas: { tamanho: number; caixa: boolean };
  texto: { tamanho: number; posicao: "topo" | "centro" | "base"; animacao: "nenhuma" | "surgir" | "subir" };
  /** Como a chamada para ação aparece: texto sobre o vídeo ou cartão animado no final. */
  encerramento: "texto" | "cartao";
  fadeFinalSeg: number;
  volumeDaTrilha: number;
  volumeDaTrilhaNasFalas: number;
}

export class ServicoEstilos {
  private estilos = new Map<string, EstiloDeEdicao>();

  /** Lê uma ou mais pastas. Em ids repetidos, a pasta posterior prevalece (estilos do usuário sobre os do programa). */
  constructor(pastas: string[]) {
    for (const pasta of pastas) {
      if (!existsSync(pasta)) continue;
      for (const arquivo of readdirSync(pasta).filter((nome) => nome.endsWith(".json")).sort()) {
        const estilo = JSON.parse(readFileSync(path.join(pasta, arquivo), "utf8")) as EstiloDeEdicao;
        this.estilos.set(estilo.id, estilo);
      }
    }
  }

  listar(): EstiloDeEdicao[] {
    return [...this.estilos.values()];
  }

  obter(id: string): EstiloDeEdicao {
    const estilo = this.estilos.get(id);
    if (!estilo) throw new NaoEncontrado("Estilo", id);
    return estilo;
  }

  /**
   * Combina estilos. A ordem importa: o primeiro define ritmo, transição, texto e encerramento;
   * os efeitos são somados, um de cada tipo. Onde os estilos discordam, o ponto volta em `divergencias`.
   */
  combinar(ids: string[]): { estilo: EstiloDeEdicao; divergencias: string[] } {
    const estilos = (ids.length ? ids : ["padrao"]).map((id) => this.obter(id));
    const [principal, ...demais] = estilos;
    const efeitos = [...principal.efeitos];
    for (const estilo of demais) for (const efeito of estilo.efeitos) if (!efeitos.some((e) => e.tipo === efeito.tipo)) efeitos.push(efeito);

    const divergencias: string[] = [];
    const comparar = (rotulo: string, valor: (e: EstiloDeEdicao) => string | number) => {
      if (new Set(estilos.map(valor)).size > 1) {
        divergencias.push(`${rotulo} diferente entre os estilos (${estilos.map((e) => `${e.id}: ${valor(e)}`).join(", ")}); usado o de "${principal.id}".`);
      }
    };
    comparar("Duração dos planos", (e) => e.duracaoDoPlanoSeg);
    comparar("Transição", (e) => e.transicao.tipo);
    comparar("Encerramento", (e) => e.encerramento);
    return {
      estilo: {
        ...principal,
        id: estilos.map((e) => e.id).join("+"),
        nome: estilos.map((e) => e.nome).join(" + "),
        efeitos,
        zoomLentoEmPlanosParados: estilos.some((e) => e.zoomLentoEmPlanosParados),
      },
      divergencias,
    };
  }
}
