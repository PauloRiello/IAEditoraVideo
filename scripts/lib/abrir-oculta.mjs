// Abre a aplicação a partir do console invisível (Windows). Primeiro deixa sinal de vida
// para o inicializador; depois carrega a aplicação. Um erro ao carregar, que antes se
// perderia no console invisível, vai para o registro.
// Uso (pelo inicializador): node abrir-oculta.mjs <caminho de principal.ts>
// Ambiente: IAEV_REGISTRO (arquivo de registro) e IAEV_MARCADOR (arquivo de sinal de vida).

import { appendFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const gravar = (texto) => {
  try {
    if (process.env.IAEV_REGISTRO) appendFileSync(process.env.IAEV_REGISTRO, `${new Date().toISOString()} ${texto}\n`);
  } catch {
    // sem onde registrar
  }
};

try {
  if (process.env.IAEV_MARCADOR) writeFileSync(process.env.IAEV_MARCADOR, `${JSON.stringify({ pid: process.pid, iniciadoEm: new Date().toISOString() })}\n`);
} catch {
  // o inicializador só espera menos
}
process.on("uncaughtException", (erro) => {
  gravar(`Erro ao abrir a aplicação: ${erro?.stack ?? erro}`);
  process.exit(1);
});
try {
  await import(pathToFileURL(process.argv[2]).href);
} catch (erro) {
  gravar(`Erro ao abrir a aplicação: ${erro?.stack ?? erro}`);
  process.exit(1);
}
