// Marcas: cadastro e arquivos (logo, fontes, manual e outros materiais). Os arquivos enviados
// são copiados para a pasta da marca, com nome único; o original nunca é tocado. No banco, os
// caminhos ficam relativos à pasta da marca, para a cópia de segurança e a restauração.

import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { ErroAplicacao, NaoEncontrado } from "../dominio/erros.ts";
import { POSICAO_PADRAO_DO_LOGO, type FonteDaMarca, type Marca, type MaterialDaMarca, type SugestoesDoManual } from "../dominio/marca.ts";
import { agora, type Banco } from "../infra/banco.ts";

interface LinhaMarca { id: string; nome: string; estado: Marca["estado"]; dados: string; criado_em: string; atualizado_em: string }

/** O que fica na coluna JSON, com caminhos relativos à pasta da marca. */
interface Dados {
  logo: string | null;
  logoClaro: string | null;
  logoPosicao: Marca["logoPosicao"];
  cores: Marca["cores"];
  fontes: { titulos: FonteDaMarca | null; texto: FonteDaMarca | null };
  materiais: MaterialDaMarca[];
  sugestoes: SugestoesDoManual | null;
}

export type PapelDoArquivo = "logo" | "logoClaro" | "material" | "fonte-titulos" | "fonte-texto";

const VAZIO: Dados = { logo: null, logoClaro: null, logoPosicao: POSICAO_PADRAO_DO_LOGO, cores: [], fontes: { titulos: null, texto: null }, materiais: [], sugestoes: null };

export class ServicoMarcas {
  private banco: Banco;
  private pasta: string;

  /** `pasta`: onde ficam as pastas das marcas (<dados>/marcas). */
  constructor(banco: Banco, pasta: string) {
    this.banco = banco;
    this.pasta = pasta;
  }

  pastaDaMarca(id: string): string {
    return path.join(this.pasta, id);
  }

  criar(nome: string): Marca {
    const limpo = nome.trim();
    if (!limpo) throw new ErroAplicacao("nome-vazio", "Dê um nome para a marca.");
    const id = randomUUID();
    this.banco.prepare("INSERT INTO marcas (id, nome, estado, dados, criado_em, atualizado_em) VALUES (?, ?, 'rascunho', ?, ?, ?)").run(id, limpo, JSON.stringify(VAZIO), agora(), agora());
    mkdirSync(this.pastaDaMarca(id), { recursive: true });
    return this.obter(id);
  }

  obter(id: string): Marca {
    const linha = this.banco.prepare("SELECT * FROM marcas WHERE id = ?").get(id) as LinhaMarca | undefined;
    if (!linha) throw new NaoEncontrado("Marca", id);
    return this.paraMarca(linha);
  }

  listar(): Marca[] {
    return (this.banco.prepare("SELECT * FROM marcas ORDER BY nome COLLATE NOCASE").all() as unknown as LinhaMarca[]).map((l) => this.paraMarca(l));
  }

  atualizar(id: string, mudancas: Partial<Pick<Marca, "nome" | "cores" | "fontes" | "logoPosicao" | "sugestoes">>): Marca {
    const atual = this.ler(id);
    const dados: Dados = { ...atual.dados };
    if (mudancas.cores) dados.cores = mudancas.cores.map((c) => ({ ...c, hex: c.hex.toUpperCase() }));
    if (mudancas.logoPosicao) dados.logoPosicao = mudancas.logoPosicao;
    if (mudancas.sugestoes !== undefined) dados.sugestoes = mudancas.sugestoes ? this.relativizarSugestoes(id, mudancas.sugestoes) : null;
    if (mudancas.fontes) {
      dados.fontes = {
        titulos: mudancas.fontes.titulos ? this.relativizarFonte(id, mudancas.fontes.titulos) : null,
        texto: mudancas.fontes.texto ? this.relativizarFonte(id, mudancas.fontes.texto) : null,
      };
    }
    const nome = mudancas.nome?.trim() || atual.linha.nome;
    this.banco.prepare("UPDATE marcas SET nome = ?, dados = ?, atualizado_em = ? WHERE id = ?").run(nome, JSON.stringify(dados), agora(), id);
    return this.obter(id);
  }

  /** Define a fonte de títulos ou de texto (Google Fonts, enviada ou pendente). */
  definirFonte(id: string, papel: "titulos" | "texto", fonte: FonteDaMarca | null): Marca {
    const { fontes } = this.obter(id);
    return this.atualizar(id, { fontes: { ...fontes, [papel]: fonte } });
  }

  /**
   * Copia um arquivo para a pasta da marca, com nome único, e o registra no papel pedido.
   * Devolve o caminho da cópia.
   */
  guardarArquivo(id: string, origem: string, papel: PapelDoArquivo): string {
    if (!existsSync(origem)) throw new NaoEncontrado("Arquivo", origem);
    const { linha, dados } = this.ler(id);
    const pasta = this.pastaDaMarca(id);
    mkdirSync(pasta, { recursive: true });
    const nome = path.basename(origem);
    const base = path.basename(nome, path.extname(nome));
    let destino = nome;
    for (let i = 2; existsSync(path.join(pasta, destino)); i += 1) destino = `${base}-${i}${path.extname(nome)}`;
    copyFileSync(origem, path.join(pasta, destino));
    if (papel === "logo") dados.logo = destino;
    else if (papel === "logoClaro") dados.logoClaro = destino;
    else if (papel === "material") dados.materiais = [...dados.materiais, { arquivo: destino, tipo: path.extname(nome).slice(1).toLowerCase(), nome }];
    else {
      const chave = papel === "fonte-titulos" ? "titulos" : "texto";
      const atual = dados.fontes[chave];
      dados.fontes = { ...dados.fontes, [chave]: { nome: atual?.nome ?? base, arquivos: [...(atual?.origem === "enviada" ? atual.arquivos : []), destino], origem: "enviada", licenca: atual?.origem === "enviada" ? atual.licenca : "enviada pelo usuário" } };
    }
    this.banco.prepare("UPDATE marcas SET dados = ?, atualizado_em = ? WHERE id = ?").run(JSON.stringify(dados), agora(), linha.id);
    return path.join(pasta, destino);
  }

  /** Marca pronta para os projetos: exige logo e ao menos uma cor confirmada. */
  marcarPronta(id: string): Marca {
    const marca = this.obter(id);
    const faltando = [marca.logo ? null : "o logo", marca.cores.length ? null : "ao menos uma cor"].filter(Boolean);
    if (faltando.length) throw new ErroAplicacao("marca-incompleta", `Falta ${faltando.join(" e ")} para a marca ficar pronta.`);
    this.banco.prepare("UPDATE marcas SET estado = 'pronta', atualizado_em = ? WHERE id = ?").run(agora(), id);
    return this.obter(id);
  }

  /** Remove a marca e a pasta dela; recusa se algum projeto a usa. */
  remover(id: string): void {
    const marca = this.obter(id);
    const usos = this.banco.prepare("SELECT nome FROM projetos WHERE json_extract(configuracao, '$.marca') = ?").all(id) as { nome: string }[];
    if (usos.length) throw new ErroAplicacao("marca-em-uso", `A marca "${marca.nome}" é usada em ${usos.map((u) => `"${u.nome}"`).join(", ")}. Troque a marca desses projetos antes de removê-la.`);
    this.banco.prepare("DELETE FROM marcas WHERE id = ?").run(id);
    rmSync(this.pastaDaMarca(id), { recursive: true, force: true });
  }

  private ler(id: string): { linha: LinhaMarca; dados: Dados } {
    const linha = this.banco.prepare("SELECT * FROM marcas WHERE id = ?").get(id) as LinhaMarca | undefined;
    if (!linha) throw new NaoEncontrado("Marca", id);
    return { linha, dados: { ...VAZIO, ...(JSON.parse(linha.dados) as Partial<Dados>) } };
  }

  private paraMarca(linha: LinhaMarca): Marca {
    const { dados } = { dados: { ...VAZIO, ...(JSON.parse(linha.dados) as Partial<Dados>) } };
    const completo = (relativo: string | null) => (relativo ? path.join(this.pastaDaMarca(linha.id), relativo) : null);
    const fonte = (f: FonteDaMarca | null) => (f ? { ...f, arquivos: f.arquivos.map((a) => completo(a) as string) } : null);
    return {
      id: linha.id, nome: linha.nome, estado: linha.estado,
      logo: completo(dados.logo), logoClaro: completo(dados.logoClaro), logoPosicao: dados.logoPosicao, cores: dados.cores,
      fontes: { titulos: fonte(dados.fontes.titulos), texto: fonte(dados.fontes.texto) },
      materiais: dados.materiais.map((m) => ({ ...m, arquivo: completo(m.arquivo) as string })),
      sugestoes: dados.sugestoes ? { ...dados.sugestoes, logos: dados.sugestoes.logos.map((l) => ({ ...l, arquivo: completo(l.arquivo) as string })) } : null,
      criadaEm: linha.criado_em, atualizadaEm: linha.atualizado_em,
    };
  }

  /** Caminho dentro da pasta da marca vira relativo; outro qualquer é recusado. */
  private relativo(id: string, caminho: string): string {
    const pasta = this.pastaDaMarca(id);
    const resolvido = path.resolve(pasta, caminho);
    if (!resolvido.startsWith(pasta + path.sep)) throw new ErroAplicacao("arquivo-fora-da-marca", "O arquivo precisa estar guardado na pasta da marca.");
    return path.relative(pasta, resolvido);
  }

  private relativizarFonte(id: string, f: FonteDaMarca): FonteDaMarca {
    return { ...f, arquivos: f.arquivos.map((a) => this.relativo(id, a)) };
  }

  private relativizarSugestoes(id: string, s: SugestoesDoManual): SugestoesDoManual {
    return { ...s, logos: s.logos.map((l) => ({ ...l, arquivo: this.relativo(id, l.arquivo) })) };
  }
}
