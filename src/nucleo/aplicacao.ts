// Núcleo da aplicação: monta os serviços, controla o ciclo de vida e é a única porta
// de entrada para qualquer interface (linha de comando hoje, janela gráfica depois).

import { EventEmitter } from "node:events";
import path from "node:path";
import { abrirBanco, copiarBanco, VERSAO_ESQUEMA, type Banco } from "../infra/banco.ts";
import { caminhosPadrao, garantirPastas, type Caminhos } from "../infra/caminhos.ts";
import { carregarConfiguracoes, salvarConfiguracoes, type Configuracoes } from "../infra/configuracoes.ts";
import { ServicoAprendizado, ServicoMemoria } from "../servicos/memoria.ts";
import { ServicoPerfis } from "../servicos/perfis.ts";
import { ServicoProjetos } from "../servicos/projetos.ts";
import { criarRegistroProvedores, type RegistroProvedores } from "../servicos/provedores.ts";
import { detectarHardware, GerenciadorVram, type Hardware } from "../servicos/recursos.ts";
import { Orquestrador } from "./orquestrador.ts";

export interface Situacao {
  versaoEsquema: number;
  pastaDados: string;
  projetos: number;
  perfis: string[];
  etapasRegistradas: string[];
  hardware: Hardware;
  vramLivreMB: number;
  provedores: Awaited<ReturnType<RegistroProvedores["situacao"]>>;
}

export class Aplicacao {
  caminhos: Caminhos;
  configuracoes: Configuracoes;
  eventos = new EventEmitter();
  projetos: ServicoProjetos;
  memoria: ServicoMemoria;
  aprendizado: ServicoAprendizado;
  perfis: ServicoPerfis;
  provedores: RegistroProvedores;
  hardware: Hardware;
  vram: GerenciadorVram;
  orquestrador: Orquestrador;
  private banco: Banco;
  private aberta = true;

  constructor(caminhos: Caminhos = caminhosPadrao()) {
    this.caminhos = caminhos;
    garantirPastas(caminhos);
    this.configuracoes = carregarConfiguracoes(caminhos.configuracoes);
    this.banco = abrirBanco(caminhos.banco);

    this.projetos = new ServicoProjetos(this.banco);
    this.memoria = new ServicoMemoria(this.banco);
    this.aprendizado = new ServicoAprendizado(this.banco);
    // Perfis do usuário (pasta de dados) prevalecem sobre os que acompanham o programa.
    this.perfis = new ServicoPerfis([caminhos.perfis, path.join(caminhos.dados, "perfis")]);
    this.provedores = criarRegistroProvedores(this.configuracoes.ia, this.configuracoes.ia.provedores);
    this.hardware = detectarHardware(path.join(caminhos.programa, "config", "local.aceleracao.json"));
    this.vram = new GerenciadorVram(this.hardware.gpu, this.configuracoes.processamento.margemVramMB);
    this.orquestrador = new Orquestrador(this.banco, this.eventos);
  }

  /** Cria um projeto usando o perfil e o formato padrão quando não informados. */
  criarProjeto(nome: string, perfilId?: string, formatoId?: string) {
    const perfil = this.perfis.obter(perfilId ?? this.configuracoes.perfilPadrao);
    const formato = this.perfis.formato(perfil.id, formatoId);
    return this.projetos.criar({ nome, perfil: perfil.id, formato: formato.id });
  }

  /** Executa o pipeline de um projeto (todas as etapas registradas ou um intervalo). */
  executarPipeline(projetoId: string, intervalo?: Parameters<Orquestrador["executar"]>[2]) {
    const projeto = this.projetos.obter(projetoId);
    return this.orquestrador.executar(projeto, this.perfis.obter(projeto.perfil), intervalo);
  }

  salvarConfiguracoes(): void {
    salvarConfiguracoes(this.caminhos.configuracoes, this.configuracoes);
  }

  /** Grava uma cópia do banco na pasta de backups e devolve o caminho do arquivo. */
  copiaDeSeguranca(): string {
    const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
    const destino = path.join(this.caminhos.backups, `editora-${carimbo}.db`);
    copiarBanco(this.banco, destino);
    return destino;
  }

  async situacao(): Promise<Situacao> {
    return {
      versaoEsquema: VERSAO_ESQUEMA,
      pastaDados: this.caminhos.dados,
      projetos: this.projetos.listar().length,
      perfis: this.perfis.listar().map((p) => p.id),
      etapasRegistradas: this.orquestrador.registradas(),
      hardware: this.hardware,
      vramLivreMB: this.vram.livreMB,
      provedores: await this.provedores.situacao(),
    };
  }

  /** Encerra a aplicação e fecha o banco. Pode ser chamado mais de uma vez. */
  encerrar(): void {
    if (!this.aberta) return;
    this.aberta = false;
    this.eventos.removeAllListeners();
    this.banco.close();
  }
}
