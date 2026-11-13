// Camada de provedores de IA. A aplicação abre e funciona sem nenhum provedor;
// só as operações que precisam de uma capacidade ausente falham, com erro claro.

import { CapacidadeIndisponivel } from "../dominio/erros.ts";
import type { Capacidade, ConfiguracaoProvedor, PedidoTexto, ProvedorIA } from "../dominio/provedores.ts";

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

  async situacao(): Promise<{ id: string; nome: string; origem: string; capacidades: Capacidade[]; disponivel: boolean }[]> {
    return Promise.all(
      this.listar().map(async (p) => ({
        id: p.id, nome: p.nome, origem: p.origem, capacidades: p.capacidades, disponivel: await p.disponivel(),
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
  private config: ConfiguracaoProvedor;
  private ambiente: NodeJS.ProcessEnv;

  constructor(config: ConfiguracaoProvedor, ambiente: NodeJS.ProcessEnv = process.env) {
    this.id = config.id;
    this.nome = config.nome;
    this.origem = config.origem;
    this.capacidades = config.capacidades;
    this.config = config;
    this.ambiente = ambiente;
  }

  private cabecalhos(): Record<string, string> {
    const chave = this.config.variavelChave ? this.ambiente[this.config.variavelChave] : undefined;
    return { "content-type": "application/json", ...(chave ? { authorization: `Bearer ${chave}` } : {}) };
  }

  private url(caminho: string): string {
    return `${this.config.urlBase.replace(/\/+$/, "")}${caminho}`;
  }

  async disponivel(): Promise<boolean> {
    if (this.config.variavelChave && !this.ambiente[this.config.variavelChave]) return false;
    try {
      const resposta = await fetch(this.url("/models"), { headers: this.cabecalhos(), signal: AbortSignal.timeout(3000) });
      return resposta.ok;
    } catch {
      return false;
    }
  }

  async gerarTexto(pedido: PedidoTexto): Promise<string> {
    const resposta = await fetch(this.url("/chat/completions"), {
      method: "POST",
      headers: this.cabecalhos(),
      body: JSON.stringify({
        model: this.config.modelo,
        temperature: pedido.temperatura ?? 0.2,
        messages: [
          ...(pedido.sistema ? [{ role: "system", content: pedido.sistema }] : []),
          { role: "user", content: pedido.mensagem },
        ],
      }),
    });
    if (!resposta.ok) throw new Error(`Provedor "${this.id}" respondeu ${resposta.status}.`);
    const corpo = (await resposta.json()) as { choices?: { message?: { content?: string } }[] };
    const texto = corpo.choices?.[0]?.message?.content;
    if (typeof texto !== "string") throw new Error(`Provedor "${this.id}" devolveu resposta sem texto.`);
    return texto;
  }
}

/** Cria o registro a partir das configurações. Provedores inativos são ignorados. */
export function criarRegistroProvedores(politica: PoliticaIA, configurados: ConfiguracaoProvedor[]): RegistroProvedores {
  const registro = new RegistroProvedores(politica);
  for (const config of configurados) {
    if (config.ativo && config.tipo === "compativel-openai") registro.registrar(new ProvedorCompativelOpenAI(config));
  }
  return registro;
}
