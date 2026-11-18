// Identidade visual de uma marca: logo, cores e fontes aplicados nos vídeos dos projetos que a
// escolhem. Nada vem de suposição: cor escrita no manual é "observado"; medida ou escolhida
// por heurística ou IA é "estimado". O usuário confirma tudo antes de a marca ficar pronta.

export type PapelDaCor = "primaria" | "secundaria" | "destaque" | "texto" | "fundo";

export interface CorDaMarca {
  /** #RRGGBB, maiúsculo. */
  hex: string;
  papel: PapelDaCor | null;
  base: "observado" | "estimado";
  /** De onde veio: "manual, página 4", "medida nas páginas", "escolhida pelo usuário". */
  fonte: string;
}

export interface FonteDaMarca {
  nome: string;
  /** Arquivos de fonte na pasta da marca (caminhos completos). */
  arquivos: string[];
  origem: "google-fonts" | "enviada" | "pendente";
  licenca: string;
}

export type CantoDoLogo = "superior-direito" | "superior-esquerdo" | "inferior-direito" | "inferior-esquerdo";

export interface MaterialDaMarca {
  /** Caminho completo da cópia na pasta da marca. */
  arquivo: string;
  tipo: string;
  /** Nome original do arquivo enviado. */
  nome: string;
}

/** O que a leitura do manual encontrou, à espera da confirmação do usuário. */
export interface SugestoesDoManual {
  cores: CorDaMarca[];
  fontes: { nome: string; pagina: number; papel: "titulos" | "texto" | null }[];
  logos: { arquivo: string; pagina: number; base: "estimado" }[];
  avisos: string[];
}

export interface Marca {
  id: string;
  nome: string;
  estado: "rascunho" | "pronta";
  logo: string | null;
  /** Variante para fundos escuros, opcional. */
  logoClaro: string | null;
  logoPosicao: { canto: CantoDoLogo; alturaRelativa: number; opacidade: number };
  cores: CorDaMarca[];
  fontes: { titulos: FonteDaMarca | null; texto: FonteDaMarca | null };
  materiais: MaterialDaMarca[];
  sugestoes: SugestoesDoManual | null;
  criadaEm: string;
  atualizadaEm: string;
}

export const POSICAO_PADRAO_DO_LOGO: Marca["logoPosicao"] = { canto: "superior-direito", alturaRelativa: 0.08, opacidade: 0.85 };
