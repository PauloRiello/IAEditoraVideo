// Gerenciamento de projetos e das mídias ligadas a eles.

import { randomUUID } from "node:crypto";
import { NaoEncontrado } from "../dominio/erros.ts";
import type { Midia, Projeto, TipoMidia } from "../dominio/tipos.ts";
import { agora, type Banco } from "../infra/banco.ts";

interface LinhaProjeto {
  id: string;
  nome: string;
  perfil: string;
  formato: string;
  criado_em: string;
  atualizado_em: string;
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
  id: l.id, nome: l.nome, perfil: l.perfil, formato: l.formato, criadoEm: l.criado_em, atualizadoEm: l.atualizado_em,
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

  criar(dados: { nome: string; perfil: string; formato: string }): Projeto {
    const nome = dados.nome.trim();
    if (!nome) throw new Error("O projeto precisa de um nome.");
    const instante = agora();
    const projeto: Projeto = { id: randomUUID(), nome, perfil: dados.perfil, formato: dados.formato, criadoEm: instante, atualizadoEm: instante };
    this.banco
      .prepare("INSERT INTO projetos (id, nome, perfil, formato, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?)")
      .run(projeto.id, projeto.nome, projeto.perfil, projeto.formato, instante, instante);
    return projeto;
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
