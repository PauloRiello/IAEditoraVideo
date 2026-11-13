// Contrato dos provedores de IA. A aplicação só conhece esta interface:
// nenhum fornecedor específico é obrigatório.

export type Capacidade = "texto" | "visao" | "transcricao" | "embeddings";

/** "local" roda no computador do usuário; "externo" depende de serviço de terceiros. */
export type OrigemProvedor = "local" | "externo";

export interface PedidoTexto {
  sistema?: string;
  mensagem: string;
  temperatura?: number;
}

export interface ProvedorIA {
  id: string;
  nome: string;
  origem: OrigemProvedor;
  capacidades: Capacidade[];
  /** Verifica se o provedor pode ser usado agora. Nunca lança erro. */
  disponivel(): Promise<boolean>;
  gerarTexto?(pedido: PedidoTexto): Promise<string>;
}

/** Como um provedor é descrito no arquivo de configurações. */
export interface ConfiguracaoProvedor {
  id: string;
  nome: string;
  /** Protocolo de comunicação. "compativel-openai" cobre Ollama, LM Studio, llama.cpp e APIs externas. */
  tipo: "compativel-openai";
  origem: OrigemProvedor;
  urlBase: string;
  modelo: string;
  capacidades: Capacidade[];
  /** Nome da variável de ambiente que guarda a chave. A chave nunca é gravada em arquivo. */
  variavelChave?: string;
  ativo: boolean;
}
