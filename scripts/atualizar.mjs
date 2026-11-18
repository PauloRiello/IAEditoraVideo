// Atualiza o programa pelo GitHub sem tocar nos dados do usuário.
// Projetos, banco, referências, preferências, perfis, aprendizados e exportações ficam em
// pastas separadas do código e não são alterados pelo Git. Antes de atualizar é criada uma
// cópia de segurança; se a nova versão não abrir, o programa volta à versão anterior.
// Uso: npm run atualizar   (no Windows: windows\Atualizar.cmd)

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { cli, copias, dizer, emExecucao, exigirInstalacao, falhar, NODE, parar, pastas } from "./lib/aplicacao.mjs";
import { RAIZ, existeComando, lerJson } from "./lib/comum.mjs";

const git = (...argumentos) => {
  const r = spawnSync("git", argumentos, { cwd: RAIZ, encoding: "utf8", windowsHide: true });
  return { ok: r.status === 0, saida: (r.stdout ?? "").trim(), erro: (r.stderr ?? "").trim() };
};
const versao = () => {
  try {
    return lerJson(path.join(RAIZ, "package.json")).version;
  } catch {
    return "?";
  }
};
const dependencias = () => {
  const pacote = lerJson(path.join(RAIZ, "package.json"));
  return JSON.stringify([pacote.dependencies, pacote.devDependencies]);
};

exigirInstalacao();
if (!existeComando("git")) falhar("o Git não está instalado.", "instale o Git (no Windows: winget install Git.Git) e tente de novo.");
if (!existsSync(path.join(RAIZ, ".git"))) {
  falhar("esta instalação não veio do Git, então não se atualiza sozinha.", "baixe a nova versão do GitHub, extraia sobre esta pasta e execute Instalar de novo. Seus dados ficam em outra pasta e são preservados.");
}

// 1. O programa não pode ter arquivos alterados à mão: a atualização não os sobrescreve.
const alterados = git("status", "--porcelain", "--untracked-files=no");
if (!alterados.ok) falhar(`o Git não conseguiu examinar a pasta do programa (${alterados.erro}).`, "confira se a pasta do programa está íntegra.");
if (alterados.saida) {
  falhar(`há arquivos do programa alterados nesta pasta:\n${alterados.saida.split("\n").slice(0, 10).map((l) => `  ${l}`).join("\n")}`,
    "desfaça essas alterações (ou guarde-as em outro lugar) e tente de novo. Personalizações devem ficar na pasta de dados, não na do programa.");
}

// 2. Há versão nova?
dizer("Procurando atualizações...");
const busca = git("fetch", "--quiet", "--prune");
if (!busca.ok) falhar("não foi possível consultar o GitHub.", `confira a conexão com a internet e tente de novo. Detalhe: ${busca.erro.split("\n").slice(-1)[0]}`);
const destino = git("rev-parse", "--verify", "--quiet", "@{upstream}");
if (!destino.ok) falhar("esta cópia do programa não acompanha nenhuma versão publicada.", "instale de novo pelo instalador, que configura a origem das atualizações.");
const anterior = git("rev-parse", "HEAD").saida;
if (anterior === destino.saida) {
  dizer(`O programa já está na versão mais recente (${versao()}).`);
  process.exit(0);
}
if (!git("merge-base", "--is-ancestor", "HEAD", "@{upstream}").ok) {
  falhar("o programa nesta pasta tem alterações próprias que a versão publicada não tem.", "isso só acontece em instalações de desenvolvimento. Resolva com o Git (git status, git log) ou instale de novo em outra pasta.");
}

// 3. Fecha a aplicação e guarda uma cópia de segurança antes de qualquer mudança.
const { dados } = pastas();
const estavaAberta = Boolean(await emExecucao(dados));
if (estavaAberta) {
  dizer("Encerrando a aplicação para atualizar...");
  await parar(dados);
}
const versaoAnterior = versao(), dependenciasAnteriores = dependencias();
const copia = cli(["backup", "pre-atualizacao"]);
if (!copia.ok) falhar(`a cópia de segurança não pôde ser criada (${(copia.erro || copia.saida).split("\n").slice(-1)[0]}).`, "nada foi alterado. Confira o espaço em disco e tente de novo.");
const nomeDaCopia = copias(dados).find((c) => c.motivo === "pre-atualizacao")?.nome;
dizer(`Cópia de segurança criada: ${nomeDaCopia}`);

/** Volta o programa à versão anterior e, se preciso, os dados à cópia feita antes da atualização. */
function desfazer(motivo, restaurarDados) {
  git("reset", "--hard", "--quiet", anterior);
  if (restaurarDados && nomeDaCopia) cli(["backup", "restaurar", nomeDaCopia]);
  falhar(`${motivo}\nO programa voltou à versão ${versaoAnterior} e seus dados estão como antes.`, "tente de novo mais tarde. Se o problema continuar, avise quem mantém o programa, informando a mensagem acima.");
}

// 4. Traz o código novo.
const avanco = git("merge", "--ff-only", "--quiet", "@{upstream}");
if (!avanco.ok) desfazer(`o código novo não pôde ser aplicado (${avanco.erro.split("\n").slice(-1)[0]}).`, false);
const mudaram = git("diff", "--name-only", anterior, "HEAD").saida.split("\n").filter(Boolean);
dizer(`Código atualizado: ${mudaram.length} arquivo(s).`);

// 5. Dependências, só se mudaram.
if (dependencias() !== dependenciasAnteriores || mudaram.some((arquivo) => /^requirements.*\.txt$/.test(arquivo))) {
  dizer("Instalando dependências da nova versão (pode levar alguns minutos)...");
  const setup = spawnSync(process.execPath, [path.join(RAIZ, "scripts", "configurar_ambiente.mjs")], { cwd: RAIZ, stdio: "inherit", windowsHide: true });
  if (setup.status !== 0) desfazer("as dependências da nova versão não puderam ser instaladas.", false);
}

// 6. Abre a aplicação uma vez: o banco é migrado, com cópia própria antes da migração.
const abertura = spawnSync(process.execPath, [...NODE, path.join(RAIZ, "src", "interface", "cli.ts"), "situacao"], { cwd: RAIZ, encoding: "utf8", windowsHide: true });
if (abertura.status !== 0) desfazer(`a nova versão não abriu (${(abertura.stderr || abertura.stdout || "").trim().split("\n").slice(-1)[0]}).`, true);
for (const linha of abertura.stdout.split("\n").filter((l) => l.startsWith("Aviso:"))) dizer(linha);

dizer(`\nAtualização concluída: versão ${versaoAnterior} -> ${versao()}.`);
dizer("Projetos, banco, referências, preferências, perfis, aprendizados e exportações foram preservados.");
if (estavaAberta) {
  dizer("Abrindo a aplicação de novo...");
  spawnSync(process.execPath, [path.join(RAIZ, "scripts", "iniciar.mjs")], { cwd: RAIZ, stdio: "inherit", windowsHide: true });
}
