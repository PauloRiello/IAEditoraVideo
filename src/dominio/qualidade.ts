// Tipos do controle de qualidade: verificações, perfis por destino, relatório e presets de exportação.

/**
 * - obrigatoria: se falhar, o vídeo é reprovado e não pode ser aceito como exceção;
 * - importante: se falhar, o vídeo fica pendente até o usuário aceitar a exceção conscientemente;
 * - recomendacao: se falhar, vira ressalva, sem bloquear.
 */
export type Gravidade = "obrigatoria" | "importante" | "recomendacao";

export type SituacaoDaVerificacao = "aprovada" | "reprovada" | "nao-avaliada" | "nao-aplicavel";

export interface Verificacao {
  /** Identificador estável, por exemplo "tecnica/codec-de-video". */
  id: string;
  grupo: "tecnica" | "visual" | "audio" | "destino";
  nome: string;
  situacao: SituacaoDaVerificacao;
  gravidade: Gravidade;
  /** O que foi encontrado. */
  detalhe: string;
  /** Como corrigir, quando reprovada. */
  sugestao: string;
  /** "observado": medido no arquivo ou lido da timeline. "estimado": heurística. */
  base: "observado" | "estimado";
  inicioSeg?: number;
  fimSeg?: number;
}

/**
 * - aprovado: nenhuma verificação falhou;
 * - aprovado-com-ressalvas: só recomendações falharam, ou as exceções importantes foram aceitas;
 * - pendente: há falha importante ainda não aceita pelo usuário;
 * - reprovado: ao menos uma verificação obrigatória falhou.
 */
export type SituacaoFinal = "aprovado" | "aprovado-com-ressalvas" | "pendente" | "reprovado";

export interface ExcecaoAceita {
  verificacaoId: string;
  justificativa: string;
  aceitaEm: string;
}

export interface RelatorioDeQualidade {
  id: number;
  projetoId: string;
  versaoDaTimeline: number;
  /** Ausente quando o relatório é só da timeline, antes de renderizar. */
  exportacaoId: number | null;
  arquivo: string | null;
  perfilDeQualidade: string;
  verificacoes: Verificacao[];
  excecoes: ExcecaoAceita[];
  situacao: SituacaoFinal;
  criadoEm: string;
}

/** Critérios de qualidade de um destino. Cada destino tem os seus: nada aqui vale para todos os vídeos. */
export interface PerfilDeQualidade {
  id: string;
  nome: string;
  /** Palavras que identificam o destino no nome da plataforma (por exemplo "instagram"). */
  plataformas: string[];
  proporcao: { orientacao: "vertical" | "horizontal" | "quadrado" | "qualquer"; gravidade: Gravidade };
  duracao: { maximaSeg: number | null; gravidade: Gravidade };
  /** Altura mínima da letra, como fração da altura do quadro. */
  texto: { tamanhoMinimo: number; gravidade: Gravidade };
  legendas: { tamanhoMinimo: number; maximoDeCaracteres: number };
  /** Margens que textos e legendas devem respeitar, como fração do quadro. */
  areaSegura: { topo: number; base: number; lados: number; gravidade: Gravidade };
  /** Se a abertura deve prender a atenção nos primeiros segundos. */
  abertura: { avaliar: boolean; segundos: number };
  ritmo: { duracaoMaximaDoPlanoSeg: number | null };
  cta: "recomendado" | "nao-avaliar";
  audio: { volumeAlvoLufs: number; picoMaximoDb: number };
}

/** Configuração de exportação. O formato é sempre MP4 com H.264 e AAC. */
export interface PresetDeExportacao {
  id: string;
  nome: string;
  /** Resolução de saída. Precisa ter a mesma proporção da timeline. Nulo = a da timeline. */
  largura: number | null;
  altura: number | null;
  /** Taxa de quadros de saída. Nulo = a da timeline. */
  fps: number | null;
  /** Qualidade do vídeo: quanto menor o CRF, maior a qualidade e o arquivo. */
  crf: number;
  velocidadeDeCodificacao: "veryfast" | "medium" | "slow";
  taxaDeBitsDoAudioKbps: number;
}
