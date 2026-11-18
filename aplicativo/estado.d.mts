// Tipos de aplicativo/estado.mjs, para os testes em TypeScript.

export function ambienteDoServidor(o: { dados: string; biblioteca: string; ambiente: string; pathAtual: string; registro: string }): Record<string, string>;
export type Linha =
  | { tipo: "etapa"; etapa: string; fracao: number }
  | { tipo: "pronta"; porta: number; token: string; avisos: string[]; jaAberta: boolean }
  | { tipo: "preparado"; faltando: string[]; avisos: string[] }
  | { tipo: "erro"; mensagem: string };
export function lerLinha(linha: string): Linha | null;
export function fracaoDaAbertura(fase: "preparando" | "abrindo", fracao: number): number;
export function podeInstalarAgora(tarefas: { estado: string }[]): boolean;
export type EventoDaAtualizacao = { tipo: "verificando" | "disponivel" | "baixando" | "baixada" | "sem-novidade" | "erro"; versao?: string; fracao?: number; mensagem?: string };
export function textoDaAtualizacao(e: EventoDaAtualizacao): string;
export function escolherBiblioteca(o: { variavel?: string; guardada?: string; documentos: string; existe: (pasta: string) => boolean }): string;
export function pastaDeTrabalhoDoServidor(ambiente: string): string;
