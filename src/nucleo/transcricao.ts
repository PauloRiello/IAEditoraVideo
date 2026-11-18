// Liga o Whisper local à aplicação: escolhe GPU ou CPU pela VRAM livre e registra o uso.

import path from "node:path";
import { transcrever, VRAM_POR_MODELO } from "../../Pipeline/transcription/whisper.ts";
import type { Transcricao } from "../dominio/analise.ts";
import { pythonDoAmbiente, type Caminhos } from "../infra/caminhos.ts";
import type { Configuracoes } from "../infra/configuracoes.ts";
import type { ServicoAcervo } from "../servicos/acervo.ts";
import type { GerenciadorVram } from "../servicos/recursos.ts";

export interface DependenciasDoTranscritor {
  caminhos: Caminhos;
  configuracoes: Configuracoes;
  acervo: ServicoAcervo;
  vram: GerenciadorVram;
}

/** Devolve a função de transcrição, ou undefined se o Whisper não estiver instalado. */
export function criarTranscritor(d: DependenciasDoTranscritor, operacao: string, projetoId: string | null = null): ((arquivo: string) => Promise<Transcricao>) | undefined {
  const python = pythonDoAmbiente(d.caminhos);
  if (!python) return undefined;
  return async (arquivo) => {
    const { modelo, idioma } = d.configuracoes.transcricao;
    // O Whisper só vai para a GPU se couber na VRAM livre; senão roda na CPU.
    const reserva = `whisper-${modelo}`;
    const dispositivo = d.vram.reservar(reserva, VRAM_POR_MODELO[modelo] ?? 4000);
    const inicio = Date.now();
    const registrar = (sucesso: boolean, usado = dispositivo) =>
      d.acervo.registrarUsoIA({ projetoId, provedor: "whisper-local", modelo, origem: "local", capacidade: "transcricao", operacao, dispositivo: usado, duracaoMs: Date.now() - inicio, sucesso });
    try {
      const { aviso, ...resultado } = await transcrever(arquivo, {
        python, modelo, idioma, dispositivo: dispositivo === "gpu" ? "cuda" : "cpu", pastaDeModelos: path.join(d.caminhos.modelos, "whisper"),
      });
      // A placa foi pedida, mas o Whisper não conseguiu usá-la: fica registrado que rodou pelo processador.
      if (aviso) console.error(`${new Date().toISOString()} ${aviso}`);
      registrar(true, aviso ? "cpu" : dispositivo);
      return resultado;
    } catch (erro) {
      registrar(false);
      throw erro;
    } finally {
      d.vram.liberar(reserva);
    }
  };
}
