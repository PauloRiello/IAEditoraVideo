// Cria uma cópia de segurança do banco (projetos, planos, timelines, aprendizados), das
// configurações e dos perfis personalizados. Funciona com a aplicação aberta ou fechada.
// Uso: npm run backup [-- --destino <pasta>] [-- --listar]
//   --destino <pasta>  copia também para outra pasta (pen drive, HD externo, nuvem)
// Os vídeos não entram na cópia: copie as pastas "Videos Brutos", "Referências" e
// "Exportações" por conta própria. As chaves de API também não entram.

import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { cli, copias, dizer, emExecucao, exigirInstalacao, falhar, MOTIVOS, pastas, pedir } from "./lib/aplicacao.mjs";

exigirInstalacao();
const argumentos = process.argv.slice(2);
const destino = argumentos.includes("--destino") ? argumentos[argumentos.indexOf("--destino") + 1] : null;
const { dados, brutos, referencias, exportacoes } = pastas();

if (argumentos.includes("--listar")) {
  const lista = copias(dados);
  dizer(lista.length ? "Cópias de segurança (da mais recente para a mais antiga):" : "Nenhuma cópia de segurança ainda.");
  for (const c of lista) dizer(`  ${c.nome}   ${c.quando}, ${MOTIVOS[c.motivo] ?? c.motivo}`);
  process.exit(0);
}
if (argumentos.includes("--destino") && !destino) falhar("faltou informar a pasta depois de --destino.", "exemplo: npm run backup -- --destino \"E:\\Backups\"");

const antes = new Set(copias(dados).map((c) => c.nome));
const aberta = await emExecucao(dados);
try {
  if (aberta) await pedir(aberta, "/api/backups", {});
  else {
    const r = cli(["backup"]);
    if (!r.ok) throw new Error(r.erro.split("\n").slice(-2).join(" "));
  }
} catch (erro) {
  falhar(`a cópia não foi criada (${erro.message}).`, "confira se há espaço em disco e tente de novo.");
}
const nova = copias(dados).find((c) => !antes.has(c.nome));
if (!nova) falhar("a cópia não apareceu na pasta de cópias de segurança.", `confira a pasta ${path.join(dados, "backups")}.`);
dizer(`Cópia de segurança criada: ${nova.pasta}`);

if (destino) {
  try {
    mkdirSync(destino, { recursive: true });
    const copia = path.join(path.resolve(destino), nova.nome);
    if (existsSync(copia)) falhar(`já existe uma cópia com este nome em ${destino}.`, "escolha outra pasta.");
    cpSync(nova.pasta, copia, { recursive: true });
    dizer(`Copiada também para: ${copia}`);
  } catch (erro) {
    falhar(`a cópia foi criada, mas não pôde ser copiada para ${destino} (${erro.message}).`, "confira se a pasta existe e se há permissão e espaço.");
  }
}
dizer("\nLembrete: os vídeos não entram nesta cópia. Para guardá-los, copie estas pastas:");
for (const pasta of [brutos, referencias, exportacoes]) dizer(`  ${pasta}`);
