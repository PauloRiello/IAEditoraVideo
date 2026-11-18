// Caso de uso da identidade visual: ler o manual da marca em segundo plano (tarefa com
// porcentagem) e guardar as sugestões para o usuário confirmar. Nada é aplicado aqui.

import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { coresMedidas, lerManual } from "../../Pipeline/brand/manual.ts";
import type { CorDaMarca, Marca } from "../dominio/marca.ts";
import { baixarDoGoogleFonts, procurarNoGoogleFonts } from "../servicos/fontes.ts";
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

/**
 * Modelo visual para ajudar a escolher o logo: só um que roda neste computador. As imagens do
 * manual da marca não vão para serviço externo.
 */
export async function escolherModeloVisual(provedores: Pick<RegistroProvedores, "selecionar">): Promise<ProvedorIA | null> {
  try {
    const provedor = await provedores.selecionar("visao");
    return provedor.origem === "local" && provedor.descreverImagens ? provedor : null;
  } catch {
    return null; // sem modelo visual: só as regras simples escolhem as candidatas
  }
}

/** Pede ao modelo visual local a ordem das candidatas a logo. */
function perguntarAoModelo(provedor: ProvedorIA): (imagens: string[]) => Promise<number[]> {
  return async (imagens) => {
    const resposta = await provedor.descreverImagens!({
      imagens,
      instrucao: `As ${imagens.length} imagens vieram do manual de uma marca, na ordem 0 a ${imagens.length - 1}. ` +
        'Ordene da mais provável à menos provável de ser o LOGO da marca. Responda somente com JSON: {"ordem": [índices]}.',
    });
    const ordem = (JSON.parse(/\{[\s\S]*\}/.exec(resposta)?.[0] ?? "{}") as { ordem?: unknown }).ordem;
    if (!Array.isArray(ordem)) throw new Error("resposta sem ordem");
    return [...new Set(ordem.map(Number).filter((n) => Number.isInteger(n)))];
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
      const modelo = await escolherModeloVisual(this.d.provedores);
      const ia = modelo ? perguntarAoModelo(modelo) : undefined;
      const nomeDaLeitura = `leitura-${path.basename(copia, path.extname(copia))}`;
      const pasta = path.join(this.d.marcas.pastaDaMarca(marcaId), nomeDaLeitura);
      const sugestoes = await lerManual(copia, { pasta, python, aoAvancar: informar, ia });
      this.d.marcas.atualizar(marcaId, { sugestoes });
      // As sugestões novas substituem as antigas: as imagens das leituras anteriores saem.
      for (const nome of readdirSync(this.d.marcas.pastaDaMarca(marcaId))) {
        if (nome.startsWith("leitura-") && nome !== nomeDaLeitura) rmSync(path.join(this.d.marcas.pastaDaMarca(marcaId), nome), { recursive: true, force: true });
      }
      this.d.registrar(`Manual da marca "${marca.nome}" lido: ${sugestoes.cores.length} cor(es), ${sugestoes.fontes.length} fonte(s) e ${sugestoes.logos.length} candidata(s) a logo para confirmar.`);
      return sugestoes;
    });
  }

  /** Usa como logo uma das candidatas encontradas no manual (pelo número na lista). */
  usarLogoSugerido(marcaId: string, indice: number): Marca {
    const candidata = this.d.marcas.obter(marcaId).sugestoes?.logos[indice];
    if (!candidata) throw new ErroAplicacao("sugestao-inexistente", "Essa sugestão de logo não existe mais. Leia o manual de novo ou envie o logo.");
    this.d.marcas.guardarArquivo(marcaId, candidata.arquivo, "logo");
    return this.d.marcas.obter(marcaId);
  }

  /** Cores medidas no logo da marca, para sugerir (estimado). */
  async coresDoLogo(marcaId: string): Promise<CorDaMarca[]> {
    const { logo } = this.d.marcas.obter(marcaId);
    if (!logo) throw new ErroAplicacao("sem-logo", "Envie o logo primeiro.");
    return (await coresMedidas([logo])).map((c) => ({ ...c, fonte: "medida no logo" }));
  }

  /** Procura a fonte no Google Fonts e, achando, baixa para a marca (o usuário já confirmou na janela). */
  baixarFonteDoGoogle(marcaId: string, papel: "titulos" | "texto", nome: string, origem?: string): TarefaIniciada {
    const marca = this.d.marcas.obter(marcaId);
    return this.d.tarefas.iniciar({ tipo: "fonte-da-marca", titulo: `Baixando a fonte ${nome} para ${marca.nome}`, projetoId: null }, async (informar) => {
      const achada = await procurarNoGoogleFonts(nome, { origem });
      if (!achada) throw new ErroAplicacao("fonte-nao-encontrada", `${nome} não está no Google Fonts. Envie o arquivo da fonte.`);
      const arquivos = await baixarDoGoogleFonts(achada.familia, path.join(this.d.marcas.pastaDaMarca(marcaId), "fontes"), { origem, aoAvancar: informar });
      this.d.marcas.definirFonte(marcaId, papel, { nome: achada.familia, arquivos, origem: "google-fonts", licenca: achada.licenca });
      this.d.registrar(`Fonte ${achada.familia} baixada do Google Fonts para a marca "${marca.nome}".`);
      return arquivos;
    });
  }
}
