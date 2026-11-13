// Configuração do Remotion (vale para a CLI e o Studio; as APIs Node recebem as opções diretamente).
// Opções: https://remotion.dev/docs/config

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);

// A aceleração é decidida por `npm run gpu`, que grava config/local.aceleracao.json
// (arquivo por máquina, fora do Git). Sem o arquivo, o Remotion usa codificação por software.
const arquivoAceleracao = path.join(process.cwd(), "config", "local.aceleracao.json");

if (existsSync(arquivoAceleracao)) {
  const aceleracao = JSON.parse(readFileSync(arquivoAceleracao, "utf8"));
  const modo = aceleracao?.remotion?.hardwareAcceleration;
  if (modo === "if-possible" || modo === "required" || modo === "disable") {
    Config.setHardwareAcceleration(modo);
  }
  const gl = aceleracao?.remotion?.gl;
  if (typeof gl === "string") {
    Config.setChromiumOpenGlRenderer(gl as Parameters<typeof Config.setChromiumOpenGlRenderer>[0]);
  }
}
