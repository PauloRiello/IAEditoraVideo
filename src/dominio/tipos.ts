// Entidades do domínio. Somente tipos: nada aqui acessa disco, rede ou banco.

/** Formato de saída de um vídeo (por exemplo, vertical para Instagram e TikTok). */
export interface FormatoSaida {
  id: string;
  nome: string;
  largura: number;
  altura: number;
  fps: number;
  duracaoMaximaSeg?: number;
}

/**
 * Perfil de especialização: adapta a edição a um tipo de conteúdo (FiveM, RedM,
 * institucional...). É dado configurável em IA/Perfis, não código.
 */
export interface Perfil {
  id: string;
  nome: string;
  descricao: string;
  formatoPadrao: string;
  formatos: FormatoSaida[];
  /** Orientações de estilo usadas no planejamento da edição. */
  diretrizes: string[];
  /** Como analisar referências deste perfil. */
  analise?: ConfiguracaoDeAnalise;
  /** Ângulos que um roteiro deste perfil pode explorar, se o material sustentar. */
  angulosDeRoteiro?: string[];
}

/** Tipo de conteúdo reconhecível em um perfil (por exemplo trailer ou gameplay). */
export interface TipoDeConteudo {
  id: string;
  nome: string;
  /** Sinais medidos que indicam o tipo, por exemplo "ritmo-rapido" ou "barras-de-cinema". */
  sinais: string[];
  /** Palavras que, ditas no vídeo, indicam o tipo. */
  palavras?: string[];
}

export interface ConfiguracaoDeAnalise {
  /**
   * "curta": espera gancho e chamada para ação. "livre": não espera.
   * "automatica": decide pela duração e pela orientação do vídeo.
   */
  estrutura: "curta" | "livre" | "automatica";
  /** Palavras que indicam chamada para ação. */
  palavrasDeCta?: string[];
  tiposDeConteudo?: TipoDeConteudo[];
}

/**
 * Quanto a aplicação faz sozinha em um projeto. A aprovação do plano pelo usuário é exigida
 * em todos os níveis, e a exportação final é sempre pedida por ele.
 * - "sugestao": cada passo é pedido pelo usuário.
 * - "assistido": gera o plano depois da análise e monta a timeline depois da aprovação.
 * - "automatico": além disso, gera a prévia logo após montar.
 */
export type NivelDeIntervencao = "sugestao" | "assistido" | "automatico";

/** O que o usuário definiu para o projeto. Campos vazios não são preenchidos por suposição. */
export interface ConfiguracaoDoProjeto {
  objetivo: string;
  publico: string;
  plataforma: string;
  /** Texto da chamada para ação. Vazio: o vídeo não terá chamada para ação. */
  cta: string;
  /** Fatos verdadeiros que podem aparecer no vídeo. */
  fatos: string[];
  /** Resolução e taxa de quadros escolhidas. Nulos: valem as do formato do perfil. */
  largura: number | null;
  altura: number | null;
  fps: number | null;
  /** Duração desejada do vídeo, em segundos. */
  duracaoSeg: number | null;
  /** Estilos de edição (IA/Estilos). */
  estilos: string[];
  intervencao: NivelDeIntervencao;
  /** Subpasta de Videos Brutos/ com o material do projeto. Vazio: a pasta com o nome do projeto. */
  pasta: string;
}

export interface Projeto {
  id: string;
  nome: string;
  perfil: string;
  formato: string;
  configuracao: ConfiguracaoDoProjeto;
  criadoEm: string;
  atualizadoEm: string;
}

export type TipoMidia = "bruto" | "referencia" | "exportacao";

export interface Midia {
  id: string;
  projetoId: string;
  tipo: TipoMidia;
  caminho: string;
  metadados: Record<string, unknown> | null;
  criadoEm: string;
}

export interface Feedback {
  id: number;
  projetoId: string;
  nota: number;
  comentario: string;
  criadoEm: string;
}

/** Registro do que aconteceu na aplicação, para o histórico do painel e dos projetos. */
export interface Atividade {
  id: number;
  projetoId: string | null;
  /** Assunto: "projeto", "material", "analise", "plano", "edicao", "render", "avaliacao", "aprendizado", "sistema". */
  tipo: string;
  descricao: string;
  criadoEm: string;
}

export type EstadoDaTarefa = "na-fila" | "executando" | "concluida" | "falhou" | "cancelada";

/** Trabalho demorado em segundo plano (análises, transcrição, render), com estado e progresso. */
export interface Tarefa {
  id: string;
  tipo: "analise-de-brutos" | "analise-de-referencias" | "roteiro" | "previa" | "exportacao" | "instalacao-ia-local";
  titulo: string;
  projetoId: string | null;
  estado: EstadoDaTarefa;
  /** De 0 a 1; nulo quando não dá para medir. */
  progresso: number | null;
  /** O que está sendo feito agora, em palavras. */
  etapa: string;
  erro: string | null;
  criadaEm: string;
  concluidaEm: string | null;
}
