// Integração com o sistema operacional: abrir uma pasta no gerenciador de arquivos.

import { spawn } from "node:child_process";

/** Abre uma pasta no Explorador de Arquivos (Windows), Finder (macOS) ou gerenciador padrão (Linux). */
export function abrirPasta(pasta: string): void {
  if (process.env.IAEV_SEM_JANELAS === "1") return; // testes e servidores sem área de trabalho
  const comando = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  spawn(comando, [pasta], { detached: true, stdio: "ignore", windowsHide: true }).on("error", () => undefined).unref();
}
