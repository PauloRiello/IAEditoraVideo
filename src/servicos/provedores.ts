// Camada de provedores de IA. A aplicação abre e funciona sem nenhum provedor;
// só as operações que precisam de uma capacidade ausente falham, com erro claro.

import { readFileSync } from "node:fs";
import { CapacidadeIndisponivel } from "../dominio/erros.ts";
import type { Capacidade, ConfiguracaoProvedor, PedidoImagens, PedidoTexto, ProvedorIA } from "../dominio/provedores.ts";

export interface PoliticaIA {
  preferirLocal: boolean;
  permitirExternos: boolean;
}

export class RegistroProvedores {
  private provedores = new Map<string, ProvedorIA>();
  private politica: PoliticaIA;

  constructor(politica: PoliticaIA) {
    this.politica = politica;
  }

  registrar(provedor: ProvedorIA): void {
    this.provedores.set(provedor.id, provedor);
  }

  /** Troca a política e todos os provedores de uma vez (as configurações mudaram). Quem já tem o registro passa a ver os novos. */
  redefinir(politica: PoliticaIA, provedores: ProvedorIA[]): void {
    this.politica = politica;
    this.provedores = new Map(provedores.map((p) => [p.id, p]));
  }

  /** O provedor pode ser usado com a política atual? Externos dependem da autorização do usuário. */
  permitido(provedor: ProvedorIA): boolean {
    return provedor.origem === "local" || this.politica.permitirExternos;
  }

  listar(): ProvedorIA[] {
    return [...this.provedores.values()];
  }

  /** Provedores que a política permite usar, com os locais na frente quando configurado. */
  private candidatos(capacidade: Capacidade): ProvedorIA[] {
    const permitidos = this.listar().filter(
      (p) => p.capacidades.includes(capacidade) && (p.origem === "local" || this.politica.permitirExternos),
    );
    if (!this.politica.preferirLocal) return permitidos;
    return [...permitidos.filter((p) => p.origem === "local"), ...permitidos.filter((p) => p.origem === "externo")];
  }

  /** Primeiro provedor disponível para a capacidade. Lança CapacidadeIndisponivel se não houver. */
  async selecionar(capacidade: Capacidade): Promise<ProvedorIA> {
    for (const provedor of this.candidatos(capacidade)) {
      if (await provedor.disponivel()) return provedor;
    }
    throw new CapacidadeIndisponivel(capacidade);
  }

  async situacao(): Promise<{ id: string; nome: string; origem: string; capacidades: Capacidade[]; disponivel: boolean; permitido: boolean; modelo?: string }[]> {
    return Promise.all(
      this.listar().map(async (p) => ({
        id: p.id, nome: p.nome, origem: p.origem, capacidades: p.capacidades, disponivel: await p.disponivel(), permitido: this.permitido(p), modelo: p.modelo,
      })),
    );
  }
}

/**
 * Provedor que fala o protocolo HTTP "compatível com OpenAI", adotado por servidores
 * locais (Ollama, LM Studio, llama.cpp) e por diversas APIs externas.
 */
export class ProvedorCompativelOpenAI implements ProvedorIA {
  id: string;
  nome: string;
  origem: ConfiguracaoProvedor["origem"];
  capacidades: Capacidade[];
  modelo: string;
  private config: ConfiguracaoProvedor;
  private ambiente: NodeJS.ProcessEnv;
  private chaveGuardada: string | undefined;

  /** `chaveGuardada` vem do cofre de credenciais e tem prioridade sobre a variável de ambiente. */
  constructor(config: ConfiguracaoProvedor, ambiente: NodeJS.ProcessEnv = process.env, chaveGuardada?: string) {
    this.chaveGuardada = chaveGuardada || undefined;
    this.id = config.id;
    this.nome = config.nome;
    this.origem = config.origem;
    this.capacidades = config.capacidades;
    this.modelo = config.modelo;
    this.config = config;
    this.ambiente = ambiente;
  }

  private chave(): string | undefined {
    return this.chaveGuardada ?? (this.config.variavelChave ? this.ambiente[this.config.variavelChave] : undefined);
  }

  private cabecalhos(): Record<string, string> {
    const chave = this.chave();
    return { "content-type": "application/json", ...(chave ? { authorization: `Bearer ${chave}` } : {}) };
  }

  private url(caminho: string): string {
    return `${this.config.urlBase.replace(/\/+$/, "")}${caminho}`;
  }

  async disponivel(): Promise<boolean> {
    if ((this.config.variavelChave || this.config.exigeChave) && !this.chave()) return false;
    try {
      const resposta = await fetch(this.url("/models"), { headers: this.cabecalhos(), signal: AbortSignal.timeout(3000) });
      return resposta.ok;
    } catch {
      return false;
    }
  }

  gerarTexto(pedido: PedidoTexto): Promise<string> {
    return this.conversar(
      [...(pedido.sistema ? [{ role: "system", content: pedido.sistema }] : []), { role: "user", content: pedido.mensagem }],
      pedido.temperatura,
    );
  }

  descreverImagens(pedido: PedidoImagens): Promise<string> {
    const imagens = pedido.imagens.map((arquivo) => ({
      type: "image_url",
      image_url: { url: `data:image/${arquivo.toLowerCase().endsWith(".png") ? "png" : "jpeg"};base64,${readFileSync(arquivo).toString("base64")}` },
    }));
    return this.conversar([{ role: "user", content: [{ type: "text", text: pedido.instrucao }, ...imagens] }]);
  }

  private async conversar(mensagens: unknown[], temperatura = 0.2): Promise<string> {
    const resposta = await fetch(this.url("/chat/completions"), {
      method: "POST",
      headers: this.cabecalhos(),
      body: JSON.stringify({ model: this.config.modelo, temperature: temperatura, messages: mensagens }),
    });
    if (!resposta.ok) throw new Error(`Provedor "${this.id}" respondeu ${resposta.status}.`);
    const corpo = (await resposta.json()) as { choices?: { message?: { content?: string } }[] };
    const texto = corpo.choices?.[0]?.message?.content;
    if (typeof texto !== "string") throw new Error(`Provedor "${this.id}" devolveu resposta sem texto.`);
    return texto;
  }
}

/** Cria o registro a partir das configurações. Provedores inativos são ignorados. */
export function criarRegistroProvedores(politica: PoliticaIA, configurados: ConfiguracaoProvedor[], chaves: Record<string, string> = {}): RegistroProvedores {
  const registro = new RegistroProvedores(politica);
  registro.redefinir(politica, provedoresConfigurados(configurados, chaves));
  return registro;
}

/** Instancia os provedores ativos das configurações, cada um com a chave do cofre, se houver. */
export function provedoresConfigurados(configurados: ConfiguracaoProvedor[], chaves: Record<string, string> = {}): ProvedorIA[] {
  return configurados
    .filter((config) => config.ativo && config.tipo === "compativel-openai")
    .map((config) => new ProvedorCompativelOpenAI(config, process.env, chaves[config.id]));
}

/** Servidores de modelos locais mais comuns e o endereço em que costumam atender. */
const SERVIDORES_LOCAIS = [
  { id: "ollama", nome: "Ollama", urlBase: "http://127.0.0.1:11434/v1" },
  { id: "lm-studio", nome: "LM Studio", urlBase: "http://127.0.0.1:1234/v1" },
  { id: "llama-cpp", nome: "llama.cpp", urlBase: "http://127.0.0.1:8080/v1" },
];

/** Procura servidores de modelos rodando neste computador e lista os modelos de cada um. Nunca lança erro. */
export async function detectarServidoresLocais(): Promise<{ id: string; nome: string; urlBase: string; modelos: string[] }[]> {
  const achados = await Promise.all(
    SERVIDORES_LOCAIS.map(async (servidor) => {
      try {
        const resposta = await fetch(`${servidor.urlBase}/models`, { signal: AbortSignal.timeout(1500) });
        if (!resposta.ok) return null;
        const corpo = (await resposta.json()) as { data?: { id?: string }[] };
        return { ...servidor, modelos: (corpo.data ?? []).map((m) => String(m.id ?? "")).filter(Boolean) };
      } catch {
        return null;
      }
    }),
  );
  return achados.filter((s): s is NonNullable<typeof s> => s !== null);
}
