// Restaura uma cópia de segurança: projetos, aprendizados e configurações voltam ao estado
// da cópia. O estado atual é guardado antes em outra cópia, para a operação poder ser
// desfeita. Os vídeos não são alterados.
// Uso: npm run restaurar                         (mostra as cópias e pergunta qual)
//      npm run restaurar -- <nome> [--sim]       (restaura a cópia indicada)
//      npm run restaurar -- <pasta de uma cópia guardada em outro lugar> [--sim]

import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { cli, copias, dizer, exigirInstalacao, falhar, MOTIVOS, parar, pastas } from "./lib/aplicacao.mjs";

exigirInstalacao();
const argumentos = process.argv.slice(2);
const confirmado = argumentos.includes("--sim");
let pedido = argumentos.find((a) => !a.startsWith("--")) ?? null;
const { dados } = pastas();
const perguntar = async (texto) => {
  const leitor = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await leitor.question(texto)).trim();
  } finally {
    leitor.close();
  }
};

// Cópia guardada em outra pasta: é trazida para a pasta de cópias antes de restaurar.
if (pedido && existsSync(path.join(pedido, "editora.db"))) {
  const nome = path.basename(path.resolve(pedido));
  if (!/^\d{4}-\d\d-\d\dT[\d-]+Z_[a-z-]+?(-\d+)?$/.test(nome)) falhar(`a pasta "${pedido}" não tem o nome de uma cópia de segurança.`, "use a pasta inteira criada pelo comando de backup, sem renomear.");
  const local = path.join(dados, "backups", nome);
  if (!existsSync(local)) cpSync(pedido, local, { recursive: true });
  pedido = nome;
}

const lista = copias(dados);
if (lista.length === 0) falhar("não há nenhuma cópia de segurança para restaurar.", "crie cópias com o comando de backup; a aplicação também cria cópias automáticas ao abrir.");
if (!pedido) {
  if (!process.stdin.isTTY) falhar("faltou dizer qual cópia restaurar.", "informe o nome da cópia. Veja os nomes com: npm run backup -- --listar");
  dizer("Cópias de segurança disponíveis:");
  lista.slice(0, 20).forEach((c, i) => dizer(`  ${String(i + 1).padStart(2)}. ${c.quando}  (${MOTIVOS[c.motivo] ?? c.motivo})`));
  const resposta = await perguntar("\nNúmero da cópia a restaurar (Enter para cancelar): ");
  const escolhida = lista[Number(resposta) - 1];
  if (!escolhida) { dizer("Nada foi alterado."); process.exit(0); }
  pedido = escolhida.nome;
}
const copia = lista.find((c) => c.nome === pedido);
if (!copia) falhar(`a cópia "${pedido}" não existe.`, "veja os nomes com: npm run backup -- --listar");

if (!confirmado) {
  if (!process.stdin.isTTY) falhar("a restauração precisa de confirmação.", "repita o comando com --sim.");
  dizer(`\nProjetos, aprendizados e configurações voltarão ao estado de ${copia.quando}.`);
  dizer("O estado atual será guardado antes em outra cópia. Os vídeos não são alterados.");
  if ((await perguntar("Digite SIM para restaurar: ")).toUpperCase() !== "SIM") { dizer("Nada foi alterado."); process.exit(0); }
}

if (await parar(dados)) dizer("A aplicação estava aberta e foi encerrada para a restauração.");
const r = cli(["backup", "restaurar", copia.nome]);
if (!r.ok) falhar(`a cópia não pôde ser restaurada (${(r.erro || r.saida).split("\n").slice(-2).join(" ")}).`, "nada foi alterado. Tente outra cópia.");
dizer(r.saida);
dizer("Restauração concluída. Abra a aplicação normalmente (Iniciar).");
