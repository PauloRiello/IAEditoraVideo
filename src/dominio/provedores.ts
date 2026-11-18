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

export interface PedidoImagens {
  instrucao: string;
  /** Caminhos de arquivos de imagem (JPEG ou PNG). */
  imagens: string[];
}

export interface ProvedorIA {
  id: string;
  nome: string;
  origem: OrigemProvedor;
  capacidades: Capacidade[];
  /** Verifica se o provedor pode ser usado agora. Nunca lança erro. */
  disponivel(): Promise<boolean>;
  gerarTexto?(pedido: PedidoTexto): Promise<string>;
  /** Responde a uma instrução olhando para as imagens. Exige a capacidade "visao". */
  descreverImagens?(pedido: PedidoImagens): Promise<string>;
  /** Nome do modelo em uso, para registro. */
  modelo?: string;
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
  /** Nome da variável de ambiente que guarda a chave, quando ela vem do ambiente. */
  variavelChave?: string;
  /**
   * O serviço exige chave. Ela vem da variável de ambiente ou do cofre de credenciais da
   * pasta de dados; nunca é gravada neste arquivo de configurações.
   */
  exigeChave?: boolean;
  ativo: boolean;
}
