// Gerenciamento de projetos e das mídias ligadas a eles.

import { randomUUID } from "node:crypto";
import { NaoEncontrado } from "../dominio/erros.ts";
import { ErroAplicacao } from "../dominio/erros.ts";
import type { ConfiguracaoDoProjeto, Midia, Projeto, TipoMidia } from "../dominio/tipos.ts";
import { agora, type Banco } from "../infra/banco.ts";

interface LinhaProjeto {
  id: string;
  nome: string;
  perfil: string;
  formato: string;
  configuracao: string;
  criado_em: string;
  atualizado_em: string;
}

export const CONFIGURACAO_DE_PROJETO_PADRAO: ConfiguracaoDoProjeto = {
  objetivo: "", publico: "", plataforma: "", cta: "", fatos: [], largura: null, altura: null, fps: null, duracaoSeg: null, estilos: [], intervencao: "assistido", pasta: "", marca: "",
};

const NIVEIS = ["sugestao", "assistido", "automatico"];

/** Confere e completa a configuração de um projeto. Valores fora do possível são recusados, não corrigidos em silêncio. */
export function normalizarConfiguracao(parcial: Partial<ConfiguracaoDoProjeto>, base: ConfiguracaoDoProjeto = CONFIGURACAO_DE_PROJETO_PADRAO): ConfiguracaoDoProjeto {
  const c = { ...base, ...parcial };
  const texto = (valor: unknown) => String(valor ?? "").trim();
  const numero = (valor: unknown, nome: string, minimo: number, maximo: number): number | null => {
    if (valor === null || valor === undefined || valor === "") return null;
    const n = Number(valor);
    if (!Number.isFinite(n) || n < minimo || n > maximo) throw new ErroAplicacao("configuracao-invalida", `${nome} deve ficar entre ${minimo} e ${maximo}.`);
    return n;
  };
  const largura = numero(c.largura, "A largura", 160, 7680), altura = numero(c.altura, "A altura", 160, 7680);
  if ((largura === null) !== (altura === null)) throw new ErroAplicacao("configuracao-invalida", "Informe a largura e a altura, ou nenhuma das duas.");
  if (largura !== null && altura !== null && (largura % 2 !== 0 || altura % 2 !== 0)) throw new ErroAplicacao("configuracao-invalida", "A largura e a altura precisam ser números pares.");
  if (!NIVEIS.includes(c.intervencao)) throw new ErroAplicacao("configuracao-invalida", "Nível de intervenção desconhecido.");
  return {
    objetivo: texto(c.objetivo), publico: texto(c.publico), plataforma: texto(c.plataforma), cta: texto(c.cta),
    fatos: (Array.isArray(c.fatos) ? c.fatos : []).map(texto).filter(Boolean),
    largura, altura, fps: numero(c.fps, "A taxa de quadros", 1, 120), duracaoSeg: numero(c.duracaoSeg, "A duração", 1, 14400),
    estilos: (Array.isArray(c.estilos) ? c.estilos : []).map(texto).filter(Boolean), intervencao: c.intervencao, pasta: texto(c.pasta), marca: texto(c.marca),
  };
}

interface LinhaMidia {
  id: string;
  projeto_id: string;
  tipo: TipoMidia;
  caminho: string;
  metadados: string | null;
  criado_em: string;
}

const paraProjeto = (l: LinhaProjeto): Projeto => ({
  id: l.id, nome: l.nome, perfil: l.perfil, formato: l.formato,
  configuracao: { ...CONFIGURACAO_DE_PROJETO_PADRAO, ...(JSON.parse(l.configuracao || "{}") as Partial<ConfiguracaoDoProjeto>) },
  criadoEm: l.criado_em, atualizadoEm: l.atualizado_em,
});

const paraMidia = (l: LinhaMidia): Midia => ({
  id: l.id, projetoId: l.projeto_id, tipo: l.tipo, caminho: l.caminho,
  metadados: l.metadados ? (JSON.parse(l.metadados) as Record<string, unknown>) : null, criadoEm: l.criado_em,
});

export class ServicoProjetos {
  private banco: Banco;

  constructor(banco: Banco) {
    this.banco = banco;
  }

  criar(dados: { nome: string; perfil: string; formato: string; configuracao?: Partial<ConfiguracaoDoProjeto> }): Projeto {
    const nome = dados.nome.trim();
    if (!nome) throw new ErroAplicacao("nome-obrigatorio", "O projeto precisa de um nome.");
    const instante = agora();
    const projeto: Projeto = {
      id: randomUUID(), nome, perfil: dados.perfil, formato: dados.formato, configuracao: normalizarConfiguracao(dados.configuracao ?? {}), criadoEm: instante, atualizadoEm: instante,
    };
    this.banco
      .prepare("INSERT INTO projetos (id, nome, perfil, formato, configuracao, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(projeto.id, projeto.nome, projeto.perfil, projeto.formato, JSON.stringify(projeto.configuracao), instante, instante);
    return projeto;
  }

  /** Altera nome, perfil, formato ou configuração de um projeto. Só os campos informados mudam. */
  atualizar(id: string, dados: { nome?: string; perfil?: string; formato?: string; configuracao?: Partial<ConfiguracaoDoProjeto> }): Projeto {
    const atual = this.obter(id);
    const nome = dados.nome === undefined ? atual.nome : dados.nome.trim();
    if (!nome) throw new ErroAplicacao("nome-obrigatorio", "O projeto precisa de um nome.");
    const configuracao = normalizarConfiguracao(dados.configuracao ?? {}, atual.configuracao);
    this.banco
      .prepare("UPDATE projetos SET nome = ?, perfil = ?, formato = ?, configuracao = ?, atualizado_em = ? WHERE id = ?")
      .run(nome, dados.perfil ?? atual.perfil, dados.formato ?? atual.formato, JSON.stringify(configuracao), agora(), id);
    return this.obter(id);
  }

  /** Marca o projeto como usado agora, para a lista de recentes. */
  tocar(id: string): void {
    this.banco.prepare("UPDATE projetos SET atualizado_em = ? WHERE id = ?").run(agora(), id);
  }

  listar(): Projeto[] {
    const linhas = this.banco.prepare("SELECT * FROM projetos ORDER BY atualizado_em DESC").all() as unknown as LinhaProjeto[];
    return linhas.map(paraProjeto);
  }

  obter(id: string): Projeto {
    const linha = this.banco.prepare("SELECT * FROM projetos WHERE id = ?").get(id) as unknown as LinhaProjeto | undefined;
    if (!linha) throw new NaoEncontrado("Projeto", id);
    return paraProjeto(linha);
  }

  /** Remove o projeto e seus registros. Os arquivos de mídia do usuário não são apagados. */
  remover(id: string): void {
    this.obter(id);
    this.banco.prepare("DELETE FROM projetos WHERE id = ?").run(id);
  }

  /** Registra uma mídia pelo caminho. O arquivo original não é copiado nem alterado. */
  registrarMidia(projetoId: string, tipo: TipoMidia, caminho: string, metadados: Record<string, unknown> | null = null): Midia {
    this.obter(projetoId);
    const midia: Midia = { id: randomUUID(), projetoId, tipo, caminho, metadados, criadoEm: agora() };
    this.banco
      .prepare("INSERT INTO midias (id, projeto_id, tipo, caminho, metadados, criado_em) VALUES (?, ?, ?, ?, ?, ?)")
      .run(midia.id, projetoId, tipo, caminho, metadados ? JSON.stringify(metadados) : null, midia.criadoEm);
    return midia;
  }

  midias(projetoId: string, tipo?: TipoMidia): Midia[] {
    const linhas = this.banco
      .prepare("SELECT * FROM midias WHERE projeto_id = ? AND (? IS NULL OR tipo = ?) ORDER BY criado_em")
      .all(projetoId, tipo ?? null, tipo ?? null) as unknown as LinhaMidia[];
    return linhas.map(paraMidia);
  }
}
