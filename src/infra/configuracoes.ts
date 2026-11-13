// Configurações do usuário, em JSON legível. Ficam na pasta de dados, não na do programa.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ConfiguracaoProvedor } from "../dominio/provedores.ts";

export interface Configuracoes {
  /** Perfil usado em projetos novos. */
  perfilPadrao: string;
  ia: {
    /** Entre provedores disponíveis com a mesma capacidade, usa primeiro os locais. */
    preferirLocal: boolean;
    /** Permite enviar dados a provedores externos. Desligado por padrão. */
    permitirExternos: boolean;
    provedores: ConfiguracaoProvedor[];
  };
  processamento: {
    /** VRAM mantida livre para o sistema e outros programas. */
    margemVramMB: number;
  };
}

export const CONFIGURACOES_PADRAO: Configuracoes = {
  perfilPadrao: "geral",
  ia: { preferirLocal: true, permitirExternos: false, provedores: [] },
  processamento: { margemVramMB: 1024 },
};

/**
 * Lê as configurações. Chaves ausentes recebem o valor padrão, de modo que um arquivo
 * gravado por uma versão antiga do programa continua válido depois de uma atualização.
 */
export function carregarConfiguracoes(arquivo: string): Configuracoes {
  const salvas = existsSync(arquivo) ? (JSON.parse(readFileSync(arquivo, "utf8")) as Partial<Configuracoes>) : {};
  return {
    ...CONFIGURACOES_PADRAO,
    ...salvas,
    ia: { ...CONFIGURACOES_PADRAO.ia, ...salvas.ia },
    processamento: { ...CONFIGURACOES_PADRAO.processamento, ...salvas.processamento },
  };
}

/** Grava em arquivo temporário e renomeia: uma queda de energia não corrompe o arquivo. */
export function salvarConfiguracoes(arquivo: string, configuracoes: Configuracoes): void {
  mkdirSync(path.dirname(arquivo), { recursive: true });
  const temporario = `${arquivo}.tmp`;
  writeFileSync(temporario, `${JSON.stringify(configuracoes, null, 2)}\n`);
  renameSync(temporario, arquivo);
}
