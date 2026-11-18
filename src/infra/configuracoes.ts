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
    /** IA local: modelo aberto que roda neste computador, operado pela própria aplicação. */
    local: {
      /** Usar a IA local quando estiver instalada. */
      ativa: boolean;
      /** Modelo escolhido; nulo = o recomendado para este computador. */
      modelo: string | null;
      /** Desliga o motor depois de tantos minutos sem uso, para liberar memória. */
      desligarAposMin: number;
    };
  };
  processamento: {
    /** VRAM mantida livre para o sistema e outros programas. */
    margemVramMB: number;
  };
  transcricao: {
    /** Modelo do Whisper: tiny, base, small, medium ou large-v3. Maiores são mais precisos e mais lentos. */
    modelo: string;
    /** Código do idioma (por exemplo "pt"). Vazio para detectar automaticamente. */
    idioma: string;
  };
  backup: {
    /** Cria uma cópia ao abrir a aplicação quando a última for mais antiga que o intervalo. */
    automatico: boolean;
    intervaloHoras: number;
    /** Quantas cópias automáticas manter. Cópias manuais nunca são apagadas. */
    manter: number;
  };
}

export const CONFIGURACOES_PADRAO: Configuracoes = {
  perfilPadrao: "geral",
  ia: { preferirLocal: true, permitirExternos: false, provedores: [], local: { ativa: true, modelo: null, desligarAposMin: 5 } },
  processamento: { margemVramMB: 1024 },
  transcricao: { modelo: "small", idioma: "" },
  backup: { automatico: true, intervaloHoras: 24, manter: 10 },
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
    ia: { ...CONFIGURACOES_PADRAO.ia, ...salvas.ia, local: { ...CONFIGURACOES_PADRAO.ia.local, ...salvas.ia?.local } },
    processamento: { ...CONFIGURACOES_PADRAO.processamento, ...salvas.processamento },
    transcricao: { ...CONFIGURACOES_PADRAO.transcricao, ...salvas.transcricao },
    backup: { ...CONFIGURACOES_PADRAO.backup, ...salvas.backup },
  };
}

/** Grava em arquivo temporário e renomeia: uma queda de energia não corrompe o arquivo. */
export function salvarConfiguracoes(arquivo: string, configuracoes: Configuracoes): void {
  mkdirSync(path.dirname(arquivo), { recursive: true });
  const temporario = `${arquivo}.tmp`;
  writeFileSync(temporario, `${JSON.stringify(configuracoes, null, 2)}\n`);
  renameSync(temporario, arquivo);
}
