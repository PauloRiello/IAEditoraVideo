// Núcleo da aplicação: monta os serviços, controla o ciclo de vida e é a única porta
// de entrada para qualquer interface (linha de comando hoje, janela gráfica depois).

import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import path from "node:path";
import { NaoEncontrado } from "../dominio/erros.ts";
import { ORDEM_ETAPAS } from "../dominio/pipeline.ts";
import {
  copiaValida, criarCopia, isolarArquivo, listarCopias, restaurarArquivos, rotacionar, validarCopia,
  type Copia, type MotivoCopia,
} from "../infra/backup.ts";
import { abrirBanco, BancoCorrompido, VERSAO_ESQUEMA, type Banco } from "../infra/banco.ts";
import { caminhosPadrao, garantirPastas, type Caminhos } from "../infra/caminhos.ts";
import { carregarConfiguracoes, CONFIGURACOES_PADRAO, salvarConfiguracoes, type Configuracoes } from "../infra/configuracoes.ts";
import { ServicoAcervo } from "../servicos/acervo.ts";
import { ServicoAprendizado } from "../servicos/aprendizado.ts";
import { ServicoEstilos } from "../servicos/estilos.ts";
import { ServicoIndice } from "../servicos/indice.ts";
import { ServicoMemoria } from "../servicos/memoria.ts";
import { ServicoPerfis } from "../servicos/perfis.ts";
import { ServicoProjetos } from "../servicos/projetos.ts";
import { criarRegistroProvedores, type RegistroProvedores } from "../servicos/provedores.ts";
import { ServicoDeQualidade } from "../servicos/qualidade.ts";
import { ServicoTimeline } from "../servicos/timeline.ts";
import { Edicao } from "./edicao.ts";
import { Feedback } from "./feedback.ts";
import { Qualidade } from "./qualidade.ts";
import { detectarHardware, GerenciadorVram, type Hardware } from "../servicos/recursos.ts";
import { Orquestrador } from "./orquestrador.ts";
import { Producao } from "./producao.ts";
import { AnaliseDeReferencias } from "./referencias.ts";

export interface Situacao {
  versaoEsquema: number;
  pastaDados: string;
  projetos: number;
  aprendizadosAtivos: number;
  copiasDeSeguranca: number;
  perfis: string[];
  etapasRegistradas: string[];
  hardware: Hardware;
  vramLivreMB: number;
  provedores: Awaited<ReturnType<RegistroProvedores["situacao"]>>;
  avisos: string[];
}

export class Aplicacao {
  caminhos: Caminhos;
  configuracoes!: Configuracoes;
  eventos = new EventEmitter();
  /** Ocorrências da abertura que o usuário deve ver (recuperações, cópias criadas). */
  avisos: string[] = [];
  projetos!: ServicoProjetos;
  memoria!: ServicoMemoria;
  aprendizado!: ServicoAprendizado;
  acervo!: ServicoAcervo;
  perfis!: ServicoPerfis;
  provedores!: RegistroProvedores;
  /** Importação e análise de vídeos de referência. */
  referencias!: AnaliseDeReferencias;
  /** Agente Coordenador: vídeos brutos, pesquisa, plano de edição, aprovação e roteiro. */
  producao!: Producao;
  /** Estilos de edição (gameplay, ação, trailer...). */
  estilos!: ServicoEstilos;
  /** Timeline editável, prévia, renderização e histórico de exportações. */
  edicao!: Edicao;
  /** Avaliação de edições, comparação de versões, métricas de resultado e controle do que foi aprendido. */
  feedback!: Feedback;
  /** Perfis de qualidade por destino e presets de exportação. */
  catalogoDeQualidade!: ServicoDeQualidade;
  /** Controle de qualidade: verificação da timeline e dos arquivos exportados, relatórios e exceções. */
  qualidade!: Qualidade;
  hardware: Hardware;
  vram: GerenciadorVram;
  orquestrador: Orquestrador;
  private banco: Banco;
  private aberta = true;

  constructor(caminhos: Caminhos = caminhosPadrao()) {
    this.caminhos = caminhos;
    garantirPastas(caminhos);
    this.lerConfiguracoes();

    const bancoExistia = existsSync(caminhos.banco);
    this.banco = this.abrirComRecuperacao();
    this.orquestrador = new Orquestrador(this.banco, this.eventos);
    this.hardware = detectarHardware(path.join(caminhos.programa, "config", "local.aceleracao.json"));
    this.vram = new GerenciadorVram(this.hardware.gpu, this.configuracoes.processamento.margemVramMB);
    this.montarServicos();

    const interrompidas = this.orquestrador.recuperarInterrompidas();
    if (interrompidas > 0) this.avisos.push(`${interrompidas} etapa(s) interrompida(s) por fechamento inesperado foram marcadas como falhas.`);
    const rendersInterrompidos = this.edicao.recuperar();
    if (rendersInterrompidos > 0) this.avisos.push(`${rendersInterrompidos} exportação(ões) interrompida(s) pelo fechamento da aplicação; podem ser repetidas.`);
    this.aprendizado.limparExpirados();
    if (bancoExistia) this.copiaAutomatica();
  }

  /** Lê as configurações; um arquivo ilegível é afastado (não apagado) e os padrões são usados. */
  private lerConfiguracoes(): void {
    try {
      this.configuracoes = carregarConfiguracoes(this.caminhos.configuracoes);
    } catch {
      const isolado = isolarArquivo(this.caminhos.configuracoes);
      this.configuracoes = structuredClone(CONFIGURACOES_PADRAO);
      this.avisos.push(`Configurações ilegíveis: usados os valores padrão. Arquivo original preservado em ${isolado}.`);
    }
  }

  private abrirBanco(): Banco {
    return abrirBanco(this.caminhos.banco, {
      antesDeMigrar: (banco, versao) => {
        const copia = criarCopia(banco, this.caminhos, "pre-migracao");
        this.avisos.push(`Banco atualizado da versão ${versao} para a ${VERSAO_ESQUEMA}. Cópia anterior em ${copia.pasta}.`);
      },
    });
  }

  /**
   * Abre o banco. Se o arquivo estiver corrompido, ele é afastado (não apagado) e a cópia
   * de segurança válida mais recente é restaurada; sem cópias, começa um banco novo.
   */
  private abrirComRecuperacao(): Banco {
    try {
      return this.abrirBanco();
    } catch (erro) {
      if (!(erro instanceof BancoCorrompido)) throw erro;
      const isolado = isolarArquivo(this.caminhos.banco);
      const copia = listarCopias(this.caminhos).find(copiaValida);
      if (copia) {
        restaurarArquivos(this.caminhos, copia, false);
        this.avisos.push(`Banco corrompido: restaurada a cópia de ${copia.criadaEm}. Arquivo danificado preservado em ${isolado}.`);
      } else {
        this.avisos.push(`Banco corrompido e sem cópia de segurança: iniciado um banco novo. Arquivo danificado preservado em ${isolado}.`);
      }
      return this.abrirBanco();
    }
  }

  private montarServicos(): void {
    this.projetos = new ServicoProjetos(this.banco);
    this.memoria = new ServicoMemoria(this.banco);
    this.aprendizado = new ServicoAprendizado(this.banco);
    this.acervo = new ServicoAcervo(this.banco);
    // Perfis do usuário (pasta de dados) prevalecem sobre os que acompanham o programa.
    this.perfis = new ServicoPerfis([this.caminhos.perfis, path.join(this.caminhos.dados, "perfis")]);
    this.provedores = criarRegistroProvedores(this.configuracoes.ia, this.configuracoes.ia.provedores);
    this.orquestrador.usarBanco(this.banco);
    // Estilos do usuário (pasta de dados) prevalecem sobre os que acompanham o programa.
    this.estilos = new ServicoEstilos([path.join(this.caminhos.programa, "IA", "Estilos"), path.join(this.caminhos.dados, "estilos")]);
    this.producao = new Producao({
      caminhos: this.caminhos, configuracoes: this.configuracoes, projetos: this.projetos, acervo: this.acervo, aprendizado: this.aprendizado,
      memoria: this.memoria, perfis: this.perfis, indice: new ServicoIndice(this.banco), estilos: this.estilos, provedores: this.provedores, vram: this.vram,
    });
    const timelines = new ServicoTimeline(this.banco);
    // Perfis de qualidade e presets do usuário (pasta de dados) prevalecem sobre os do programa.
    this.catalogoDeQualidade = new ServicoDeQualidade(
      [path.join(this.caminhos.programa, "IA", "Qualidade"), path.join(this.caminhos.dados, "qualidade")],
      [path.join(this.caminhos.programa, "IA", "Exportacao"), path.join(this.caminhos.dados, "presets")],
    );
    this.qualidade = new Qualidade({ banco: this.banco, projetos: this.projetos, acervo: this.acervo, timelines, catalogo: this.catalogoDeQualidade });
    this.edicao = new Edicao({
      caminhos: this.caminhos, projetos: this.projetos, acervo: this.acervo, aprendizado: this.aprendizado, memoria: this.memoria, estilos: this.estilos,
      timelines, producao: this.producao, hardware: this.hardware, eventos: this.eventos, qualidade: this.qualidade, catalogo: this.catalogoDeQualidade,
    });
    this.feedback = new Feedback({ banco: this.banco, projetos: this.projetos, aprendizado: this.aprendizado, timelines });
    this.referencias = new AnaliseDeReferencias({
      caminhos: this.caminhos, configuracoes: this.configuracoes, acervo: this.acervo, aprendizado: this.aprendizado,
      perfis: this.perfis, provedores: this.provedores, vram: this.vram,
    });
  }

  private copiaAutomatica(): void {
    const { automatico, intervaloHoras, manter } = this.configuracoes.backup;
    if (!automatico) return;
    const ultima = listarCopias(this.caminhos)[0];
    const idadeHoras = ultima ? (Date.now() - Date.parse(ultima.criadaEm)) / 3_600_000 : Infinity;
    if (idadeHoras < intervaloHoras) return;
    criarCopia(this.banco, this.caminhos, "automatica");
    rotacionar(this.caminhos, manter);
  }

  /** Cria um projeto usando o perfil e o formato padrão quando não informados. */
  criarProjeto(nome: string, perfilId?: string, formatoId?: string) {
    const perfil = this.perfis.obter(perfilId ?? this.configuracoes.perfilPadrao);
    const formato = this.perfis.formato(perfil.id, formatoId);
    return this.projetos.criar({ nome, perfil: perfil.id, formato: formato.id });
  }

  /** Aprendizados que valem para um projeto: os do perfil dele mais os perfis adicionais pedidos. */
  aprendizadosDoProjeto(projetoId: string, perfisAdicionais: string[] = [], resolverPorOrdem = false) {
    const projeto = this.projetos.obter(projetoId);
    return this.aprendizado.consultar({ projetoId, perfis: [projeto.perfil, ...perfisAdicionais], resolverPorOrdem });
  }

  /**
   * Executa o pipeline de um projeto (todas as etapas registradas ou um intervalo).
   * A renderização só roda com o plano atual aprovado pelo usuário.
   */
  executarPipeline(projetoId: string, intervalo?: Parameters<Orquestrador["executar"]>[2]) {
    const projeto = this.projetos.obter(projetoId);
    const alcancaRender =
      this.orquestrador.registradas().includes("rendering") &&
      ORDEM_ETAPAS.indexOf(intervalo?.de ?? "ingestion") <= ORDEM_ETAPAS.indexOf("rendering") &&
      ORDEM_ETAPAS.indexOf(intervalo?.ate ?? "quality-control") >= ORDEM_ETAPAS.indexOf("rendering");
    if (alcancaRender) this.producao.exigirPlanoAprovado(projetoId);
    return this.orquestrador.executar(projeto, this.perfis.obter(projeto.perfil), intervalo);
  }

  salvarConfiguracoes(): void {
    salvarConfiguracoes(this.caminhos.configuracoes, this.configuracoes);
  }

  // --- Cópias de segurança -----------------------------------------------------

  /** Cria uma cópia do banco e das configurações na pasta de backups. */
  copiaDeSeguranca(motivo: MotivoCopia = "manual"): Copia {
    return criarCopia(this.banco, this.caminhos, motivo);
  }

  copias(): Copia[] {
    return listarCopias(this.caminhos);
  }

  /**
   * Volta o banco e as configurações ao estado de uma cópia. Antes de trocar, valida a
   * cópia e guarda o estado atual em uma cópia "pre-restauracao", para que a operação
   * possa ser desfeita.
   */
  restaurar(nome: string): Copia {
    const copia = this.copias().find((c) => c.nome === nome || c.pasta === nome);
    if (!copia) throw new NaoEncontrado("Cópia de segurança", nome);
    validarCopia(copia);
    const anterior = criarCopia(this.banco, this.caminhos, "pre-restauracao");
    this.banco.close();
    restaurarArquivos(this.caminhos, copia, true);
    this.lerConfiguracoes();
    this.banco = this.abrirBanco();
    this.montarServicos();
    return anterior;
  }

  async situacao(): Promise<Situacao> {
    return {
      versaoEsquema: VERSAO_ESQUEMA,
      pastaDados: this.caminhos.dados,
      projetos: this.projetos.listar().length,
      aprendizadosAtivos: this.aprendizado.listar({ estado: "ativo" }).length,
      copiasDeSeguranca: this.copias().length,
      perfis: this.perfis.listar().map((p) => p.id),
      etapasRegistradas: this.orquestrador.registradas(),
      hardware: this.hardware,
      vramLivreMB: this.vram.livreMB,
      provedores: await this.provedores.situacao(),
      avisos: this.avisos,
    };
  }

  /**
   * Encerra a aplicação e fecha o banco. Pode ser chamado mais de uma vez. Renders em
   * andamento são interrompidos; para esperar que parem com calma, chame antes
   * `await app.edicao.cancelarTudo()`.
   */
  encerrar(): void {
    if (!this.aberta) return;
    this.aberta = false;
    void this.edicao.cancelarTudo().catch(() => undefined);
    this.eventos.removeAllListeners();
    this.banco.close();
  }
}
