// Executa todas as verificações, uma por ferramenta, e mostra um resumo.
// Uso: npm run verificar
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AMBIENTE, RAIZ } from "../lib/comum.mjs";

const pasta = path.dirname(fileURLToPath(import.meta.url));
const verificacoes = [
  "node", "python", "typescript", "ffmpeg", "ffprobe", "gpu",
  "gsap", "remotion", "hyperframes", "whisper", "yt-dlp", "skills",
];

const resultados = [];
for (const nome of verificacoes) {
  const r = spawnSync(process.execPath, [path.join(pasta, `${nome}.mjs`)], { cwd: RAIZ, env: AMBIENTE, encoding: "utf8" });
  process.stdout.write(r.stdout ?? "");
  process.stderr.write(r.stderr ?? "");
  const avisos = /\[AVISO\]/.test(r.stdout ?? "");
  resultados.push({ nome, situacao: r.status !== 0 ? "FALHOU" : avisos ? "OK com avisos" : "OK" });
}

console.log("\n== Resumo ==");
for (const { nome, situacao } of resultados) console.log(`  ${nome.padEnd(12)} ${situacao}`);
const falhas = resultados.filter((r) => r.situacao === "FALHOU").length;
console.log(`\n  ${resultados.length - falhas} de ${resultados.length} verificações passaram.`);
process.exitCode = falhas > 0 ? 1 : 0;
