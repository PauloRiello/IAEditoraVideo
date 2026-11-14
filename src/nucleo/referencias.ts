// Caso de uso: importar vídeos de referência, analisá-los e guardar o conhecimento
// extraído na memória persistente (relatórios, perfil de estilo e aprendizados candidatos).

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { analisarReferencia } from "../../Pipeline/analysis/analisador.ts";
import { paraMarkdown } from "../../Pipeline/analysis/regras.ts";
import type { RelatorioReferencia } from "../dominio/analise.ts";
import type { Aprendizado, Referencia } from "../dominio/memoria.ts";
import type { Capacidade } from "../dominio/provedores.ts";
import type { Caminhos } from "../infra/caminhos.ts";
import type { Configuracoes } from "../infra/configuracoes.ts";
import type { ServicoAcervo } from "../servicos/acervo.ts";
import type { ServicoAprendizado } from "../servicos/aprendizado.ts";
import type { ServicoPerfis } from "../servicos/perfis.ts";
import type { RegistroProvedores } from "../servicos/provedores.ts";
import type { GerenciadorVram } from "../servicos/recursos.ts";
import { criarTranscritor } from "./transcricao.ts";

const EXTENSOES_DE_VIDEO = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]);

export interface Dependencias {
  caminhos: Caminhos;
  configuracoes: Configuracoes;
  acervo: ServicoAcervo;
  aprendizado: ServicoAprendizado;
  perfis: ServicoPerfis;
  provedores: Pick<RegistroProvedores, "selecionar">;
  vram: GerenciadorVram;
}

export interface ResultadoDaAnalise {
  relatorio: RelatorioReferencia;
  arquivoJson: string;
  arquivoMarkdown: string;
  /** Aprendizados que esta referência criou ou reforçou. */
  aprendizados: Aprendizado[];
}

export class AnaliseDeReferencias {
  private d: Dependencias;

  constructor(dependencias: Dependencias) {
    this.d = dependencias;
  }

  /** Registra um vídeo como referência. O arquivo fica onde está; nada é copiado. */
  importar(arquivo: string, dados: { titulo?: string; perfil?: string; autorizacao?: string } = {}): Referencia {
    const caminho = path.resolve(arquivo);
    if (!existsSync(caminho)) throw new Error(`Arquivo não encontrado: ${caminho}`);
    const existente = this.d.acervo.referencias().find((r) => r.caminho === caminho);
    if (existente) return existente;
    if (dados.perfil) this.d.perfis.obter(dados.perfil);
    return this.d.acervo.adicionarReferencia({
      titulo: dados.titulo ?? path.basename(caminho, path.extname(caminho)), caminho, perfil: dados.perfil, autorizacao: dados.autorizacao,
    });
  }

  /**
   * Registra os vídeos novos da pasta Referências/. Um vídeo dentro de uma subpasta com o
   * nome de um perfil (por exemplo Referências/fivem/) é associado a esse perfil.
   */
  importarPasta(): Referencia[] {
    const perfis = new Set(this.d.perfis.listar().map((p) => p.id));
    const conhecidos = new Set(this.d.acervo.referencias().map((r) => r.caminho));
    const novas: Referencia[] = [];
    const percorrer = (pasta: string, perfil?: string) => {
      for (const item of readdirSync(pasta, { withFileTypes: true })) {
        const caminho = path.join(pasta, item.name);
        if (item.isDirectory()) percorrer(caminho, perfil ?? (perfis.has(item.name) ? item.name : undefined));
        else if (EXTENSOES_DE_VIDEO.has(path.extname(item.name).toLowerCase()) && !conhecidos.has(caminho)) novas.push(this.importar(caminho, { perfil }));
      }
    };
    if (existsSync(this.d.caminhos.referencias)) percorrer(this.d.caminhos.referencias);
    return novas;
  }

  /** Último relatório de uma referência em texto legível (Markdown), se houver. */
  relatorioEmMarkdown(referenciaId: string): string | null {
    const relatorio = this.relatorio(referenciaId);
    return relatorio ? paraMarkdown(relatorio) : null;
  }

  /** Último relatório gravado de uma referência, se houver. */
  relatorio(referenciaId: string): RelatorioReferencia | null {
    return (this.d.acervo.analises({ referenciaId }, "referencia")[0]?.resultado as RelatorioReferencia | undefined) ?? null;
  }

  /**
   * Analisa uma referência e guarda o resultado. Analisar de novo substitui o que a mesma
   * referência havia ensinado, sem contar em dobro. Uma única referência só gera
   * aprendizados candidatos: eles passam a valer quando outra fonte os confirma.
   */
  async analisar(referenciaId: string, opcoes: { perfil?: string; transcrever?: boolean } = {}): Promise<ResultadoDaAnalise> {
    const { acervo, aprendizado, caminhos, configuracoes } = this.d;
    const referencia = acervo.referencia(referenciaId);
    if (!referencia.caminho || !existsSync(referencia.caminho)) throw new Error(`A referência "${referencia.titulo}" não tem arquivo local para analisar.`);
    const perfil = this.d.perfis.obter(opcoes.perfil ?? referencia.perfil ?? configuracoes.perfilPadrao);
    const pasta = path.join(caminhos.analises, referencia.id);

    const relatorio = await analisarReferencia(referencia.caminho, {
      titulo: referencia.titulo,
      referenciaId: referencia.id,
      perfil,
      pastaDeQuadros: path.join(pasta, "quadros"),
      provedores: {
        selecionar: async (capacidade: Capacidade) => {
          const provedor = await this.d.provedores.selecionar(capacidade);
          acervo.registrarUsoIA({
            projetoId: null, provedor: provedor.id, modelo: provedor.modelo ?? "", origem: provedor.origem, capacidade,
            operacao: "analise-de-referencia", dispositivo: null, duracaoMs: null, sucesso: true,
          });
          return provedor;
        },
      },
      transcrever: opcoes.transcrever === false ? undefined : criarTranscritor(this.d, "analise-de-referencia"),
    });

    // Relatórios em arquivo (para leitura) e no banco (para a aplicação).
    mkdirSync(pasta, { recursive: true });
    const arquivoJson = path.join(pasta, "relatorio.json"), arquivoMarkdown = path.join(pasta, "relatorio.md");
    writeFileSync(arquivoJson, `${JSON.stringify(relatorio, null, 2)}\n`);
    writeFileSync(arquivoMarkdown, paraMarkdown(relatorio));
    acervo.registrarAnalise({ referenciaId }, "referencia", relatorio);
    acervo.registrarAnalise({ referenciaId }, "perfil-de-estilo", relatorio.perfilDeEstilo);

    // Regras viram observações na memória de aprendizado, ligadas a esta referência.
    aprendizado.esquecerReferencia(referenciaId);
    const aprendizados = relatorio.regras.map((regra) =>
      aprendizado.observar({
        escopo: perfil.id === "geral" ? "geral" : "especializacao",
        perfil: perfil.id,
        categoria: regra.categoria,
        chave: regra.chave,
        valor: regra.valor,
        descricao: regra.descricao,
        contexto: regra.exemplo,
        origem: "analise",
        referenciaObservada: referenciaId,
        detalhe: `Referência "${referencia.titulo}": ${regra.base}, confiança ${regra.confianca}`,
      }),
    );
    return { relatorio, arquivoJson, arquivoMarkdown, aprendizados };
  }
}
