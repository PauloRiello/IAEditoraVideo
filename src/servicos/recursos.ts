// Recursos do computador: CPU, memória e GPU. Decide onde cada modelo de IA roda.

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";

export interface Gpu {
  fabricante: string;
  nome: string;
  vramMB: number | null;
}

export interface Hardware {
  plataforma: string;
  nucleos: number;
  memoriaTotalMB: number;
  gpu: Gpu | null;
}

/**
 * Lê o hardware. A GPU vem do arquivo gravado por `npm run gpu`
 * (config/local.aceleracao.json); sem ele, a aplicação assume que não há GPU.
 */
export function detectarHardware(arquivoAceleracao?: string): Hardware {
  let gpu: Gpu | null = null;
  if (arquivoAceleracao && existsSync(arquivoAceleracao)) {
    try {
      gpu = (JSON.parse(readFileSync(arquivoAceleracao, "utf8")) as { gpu?: Gpu | null }).gpu ?? null;
    } catch {
      gpu = null; // arquivo ilegível: segue por CPU
    }
  }
  return {
    plataforma: `${process.platform}-${process.arch}`,
    nucleos: os.cpus().length,
    memoriaTotalMB: Math.round(os.totalmem() / 1024 / 1024),
    gpu,
  };
}

export type Dispositivo = "gpu" | "cpu";

/**
 * Controla o uso de VRAM. Um modelo só vai para a GPU se couber junto com os que já
 * estão carregados; caso contrário roda na CPU. Somente GPU NVIDIA com VRAM conhecida
 * é usada para modelos de IA.
 */
export class GerenciadorVram {
  private totalMB: number;
  private margemMB: number;
  private reservas = new Map<string, number>();

  constructor(gpu: Gpu | null, margemMB: number) {
    this.totalMB = gpu?.fabricante === "nvidia" && gpu.vramMB ? gpu.vramMB : 0;
    this.margemMB = margemMB;
  }

  get livreMB(): number {
    const usado = [...this.reservas.values()].reduce((soma, mb) => soma + mb, 0);
    return Math.max(0, this.totalMB - this.margemMB - usado);
  }

  /** Reserva VRAM para um modelo e informa onde ele deve rodar. */
  reservar(modelo: string, necessarioMB: number): Dispositivo {
    this.liberar(modelo);
    if (necessarioMB > this.livreMB) return "cpu";
    this.reservas.set(modelo, necessarioMB);
    return "gpu";
  }

  liberar(modelo: string): void {
    this.reservas.delete(modelo);
  }
}
