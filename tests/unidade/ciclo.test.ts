// Testes do ciclo de vida da aplicação instalada, pelos mesmos scripts que o usuário usa:
// instalar, iniciar, parar, backup, restaurar e atualizar pelo Git. A instalação é uma
// cópia do programa em pasta temporária, com os dados em outra pasta, e roda em processos
// próprios, sem nenhuma ferramenta de desenvolvimento.
// Executar: npm test

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const base = mkdtempSync(path.join(os.tmpdir(), "iaev-ciclo-"));
const fonte = path.join(base, "publicado"), instalacao = path.join(base, "programa"), dados = path.join(base, "dados do usuário"), biblioteca = path.join(base, "vídeos");

// O ambiente dos processos não tem nada da sessão de desenvolvimento nem pastas forçadas por variável.
const ambiente: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([nome]) => !/^IAEV_|CLAUDE|ANTHROPIC/i.test(nome)));
Object.assign(ambiente, { IAEV_SEM_JANELAS: "1", IAEV_PORTA: "0" });

interface Resultado { codigo: number; saida: string }
const rodar = (comando: string, argumentos: string[], pasta: string): Resultado => {
  const r = spawnSync(comando, argumentos, { cwd: pasta, env: ambiente, encoding: "utf8", input: "" });
  return { codigo: r.status ?? -1, saida: `${r.stdout}${r.stderr}` };
};
const script = (nome: string, ...argumentos: string[]) => rodar(process.execPath, [path.join(instalacao, "scripts", `${nome}.mjs`), ...argumentos], instalacao);
const cli = (...argumentos: string[]) => rodar(process.execPath, ["--disable-warning=ExperimentalWarning", "src/interface/cli.ts", ...argumentos], instalacao);
const git = (pasta: string, ...argumentos: string[]) => execFileSync("git", ["-c", "user.name=Teste", "-c", "user.email=teste@exemplo.invalid", "-c", "commit.gpgsign=false", ...argumentos], { cwd: pasta, encoding: "utf8" }).trim();
const publicar = (mensagem: string, alterar: () => void): string => {
  alterar();
  git(fonte, "add", "-A");
  git(fonte, "commit", "-q", "-m", mensagem);
  return git(fonte, "rev-parse", "HEAD");
};
const execucao = (): { pid: number; porta: number; token: string } | null => {
  const arquivo = path.join(dados, "execucao.json");
  return existsSync(arquivo) ? JSON.parse(readFileSync(arquivo, "utf8")) : null;
};
const vivo = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const painel = async () => {
  const e = execucao()!;
  return (await (await fetch(`http://127.0.0.1:${e.porta}/api/painel`, { headers: { "x-iaev-sessao": e.token } })).json()) as { versao: string; totalDeProjetos: number };
};
const copias = () => readdirSync(path.join(dados, "backups")).sort();

before(() => {
  // "Versão publicada": os arquivos do programa como estão agora, em um repositório Git próprio.
  const arquivos = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: RAIZ, encoding: "utf8" }).split("\0").filter(Boolean);
  for (const arquivo of arquivos) {
    if (!existsSync(path.join(RAIZ, arquivo))) continue;
    mkdirSync(path.dirname(path.join(fonte, arquivo)), { recursive: true });
    cpSync(path.join(RAIZ, arquivo), path.join(fonte, arquivo));
  }
  git(fonte, "init", "-q", "-b", "main");
  git(fonte, "add", "-A");
  git(fonte, "commit", "-q", "-m", "Versão inicial");
  // Instalação: uma cópia obtida pelo Git, como faz o instalador. As dependências já baixadas são reaproveitadas.
  git(base, "clone", "-q", fonte, instalacao);
  for (const pasta of ["node_modules", ".venv"]) if (existsSync(path.join(RAIZ, pasta))) symlinkSync(path.join(RAIZ, pasta), path.join(instalacao, pasta), "dir");
});

after(() => {
  const e = execucao();
  if (e && vivo(e.pid)) process.kill(e.pid);
  rmSync(base, { recursive: true, force: true });
});

test("instalar: configura as pastas escolhidas, prepara o banco e pode ser repetido sem perder nada", () => {
  // Primeira instalação: sem escolha anterior, valem as pastas sugeridas pelo instalador.
  const r = script("instalar", "--padrao", "--sugerir-dados", dados, "--sugerir-biblioteca", biblioteca, "--sem-configurar", "--sem-verificar", "--sem-atalho");
  assert.equal(r.codigo, 0, r.saida);
  assert.match(r.saida, /100% \| Instalação concluída/);
  assert.match(r.saida, /\d+% \| 5 de 6: IA local \(opcional\) ==\n.*Etapa pulada/, "sem perguntas, a IA local (3 GB) não é baixada");
  assert.deepEqual(JSON.parse(readFileSync(path.join(instalacao, "config", "local.instalacao.json"), "utf8")), { dados, biblioteca });
  assert.ok(existsSync(path.join(dados, "banco", "editora.db")), "o banco fica na pasta de dados, fora do programa");
  for (const pasta of ["Videos Brutos", "Referências", "Exportações"]) assert.ok(existsSync(path.join(biblioteca, pasta)), pasta);
  assert.ok(!existsSync(path.join(instalacao, "Dados", "banco")), "nada de dados dentro da pasta do programa");
  assert.equal(git(instalacao, "status", "--porcelain", "--untracked-files=no"), "", "a instalação não altera arquivos do programa");

  assert.equal(cli("projeto", "criar", "Cidade Alta", "fivem").codigo, 0);
  const denovo = script("instalar", "--padrao", "--sem-configurar", "--sem-verificar", "--sem-atalho");
  assert.equal(denovo.codigo, 0, denovo.saida);
  assert.match(denovo.saida, /Instalação anterior encontrada/);
  assert.match(cli("projeto", "listar").saida, /Cidade Alta/);

  // O instalador do Windows sempre sugere as pastas padrão: numa reinstalação, valem as escolhidas antes.
  const comSugestao = script("instalar", "--padrao", "--sugerir-dados", path.join(base, "outra"), "--sugerir-biblioteca", path.join(base, "outra biblioteca"), "--sem-configurar", "--sem-verificar", "--sem-atalho");
  assert.equal(comSugestao.codigo, 0, comSugestao.saida);
  assert.deepEqual(JSON.parse(readFileSync(path.join(instalacao, "config", "local.instalacao.json"), "utf8")), { dados, biblioteca }, "a sugestão não troca as pastas de uma instalação existente");
  assert.ok(!existsSync(path.join(base, "outra")));
  assert.match(cli("projeto", "listar").saida, /Cidade Alta/);

  const invalida = script("instalar", "--padrao", "--dados", "pasta-relativa", "--sem-configurar", "--sem-verificar", "--sem-atalho");
  assert.equal(invalida.codigo, 1);
  assert.match(invalida.saida, /Não foi possível concluir.*caminho completo.*O que fazer:/s);
});

test("iniciar e parar: a aplicação roda sozinha, em processo próprio, uma instância por vez", async () => {
  const inicio = script("iniciar");
  assert.equal(inicio.codigo, 0, inicio.saida);
  assert.match(inicio.saida, /Aplicação iniciada/);
  const e = execucao()!;
  assert.ok(e.pid !== process.pid && vivo(e.pid) && e.porta > 0 && /^[a-f0-9]{48}$/.test(e.token));
  assert.deepEqual(await painel(), { ...(await painel()), totalDeProjetos: 1 });
  assert.ok(!readFileSync(path.join(dados, "logs", "aplicacao.log"), "utf8").includes(e.token), "o segredo da sessão não vai para o registro");

  const denovo = script("iniciar");
  assert.match(denovo.saida, /já está aberta/);
  assert.equal(execucao()!.pid, e.pid, "não abre uma segunda instância");

  // Cópia de segurança com a aplicação aberta, também para outra pasta.
  const externo = path.join(base, "pen drive");
  const copia = script("backup", "--destino", externo);
  assert.equal(copia.codigo, 0, copia.saida);
  assert.match(copia.saida, /Cópia de segurança criada.*Copiada também para.*os vídeos não entram/s);
  assert.deepEqual(readdirSync(path.join(externo, readdirSync(externo)[0])).sort(), ["configuracoes.json", "editora.db"].filter((nome) => nome === "editora.db" || existsSync(path.join(dados, "config", "configuracoes.json"))));

  const parada = script("parar");
  assert.match(parada.saida, /foi encerrada/);
  assert.ok(!vivo(e.pid) && execucao() === null, "o processo terminou e limpou o registro de execução");
  assert.match(script("parar").saida, /não estava aberta/);
  assert.match(readFileSync(path.join(dados, "logs", "aplicacao.log"), "utf8"), /pronta em .*\n.*Aplicação encerrada/);
});

test("se a abertura sem janelas falhar, a aplicação abre do jeito simples; erro ao carregar vai para o registro", async () => {
  // Simula um Windows em que o console invisível não abre a aplicação.
  const r = spawnSync(process.execPath, [path.join(instalacao, "scripts", "iniciar.mjs")], { cwd: instalacao, env: { ...ambiente, IAEV_TESTE_ABERTURA_OCULTA: "falha" }, encoding: "utf8", input: "" });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /Abrindo do jeito simples.*Aplicação iniciada/s);
  const e = execucao()!;
  assert.ok(vivo(e.pid));
  assert.match(readFileSync(path.join(dados, "logs", "aplicacao.log"), "utf8"), /console invisível não funcionou/);
  assert.match(script("parar").saida, /foi encerrada/);

  // Um erro ao carregar a aplicação, que antes sumiria no console invisível, fica no registro.
  const registro = path.join(base, "erro-ao-abrir.log"), marcador = path.join(base, "abrindo.json");
  const falha = spawnSync(process.execPath, [path.join(instalacao, "scripts", "lib", "abrir-oculta.mjs"), path.join(base, "nao-existe.ts")], { env: { ...ambiente, IAEV_REGISTRO: registro, IAEV_MARCADOR: marcador }, encoding: "utf8" });
  assert.equal(falha.status, 1);
  assert.ok(existsSync(marcador), "deu sinal de vida antes de carregar");
  assert.match(readFileSync(registro, "utf8"), /Erro ao abrir a aplicação: .*nao-existe\.ts/s);
});

test("atualizar pelo Git: cópia de segurança antes, dados preservados e aplicação reaberta", async () => {
  assert.match(script("atualizar").saida, /já está na versão mais recente/);
  const nova = publicar("Versão nova", () => {
    const pacote = JSON.parse(readFileSync(path.join(fonte, "package.json"), "utf8"));
    writeFileSync(path.join(fonte, "package.json"), `${JSON.stringify({ ...pacote, version: "9.9.9" }, null, 2)}\n`);
    writeFileSync(path.join(fonte, "NOVIDADES.txt"), "Arquivo que só existe na versão nova.\n");
  });

  // Arquivo do programa alterado à mão: a atualização recusa, explica e não muda nada.
  appendFileSync(path.join(instalacao, "README.md"), "\nalteração local\n");
  const recusada = script("atualizar");
  assert.equal(recusada.codigo, 1);
  assert.match(recusada.saida, /arquivos do programa alterados.*README\.md.*O que fazer:/s);
  git(instalacao, "checkout", "--", "README.md");
  assert.ok(!existsSync(path.join(instalacao, "NOVIDADES.txt")));

  script("iniciar");
  const antes = execucao()!;
  const r = script("atualizar");
  assert.equal(r.codigo, 0, r.saida);
  assert.match(r.saida, /Cópia de segurança criada: .*_pre-atualizacao/);
  assert.match(r.saida, /Atualização concluída: versão \d+\.\d+\.\d+ -> 9\.9\.9/);
  assert.match(r.saida, /foram preservados/);
  assert.equal(git(instalacao, "rev-parse", "HEAD"), nova);
  assert.ok(existsSync(path.join(instalacao, "NOVIDADES.txt")));
  assert.ok(copias().some((nome) => nome.endsWith("_pre-atualizacao")));
  assert.deepEqual(JSON.parse(readFileSync(path.join(instalacao, "config", "local.instalacao.json"), "utf8")), { dados, biblioteca }, "as pastas escolhidas continuam valendo");

  // A aplicação estava aberta: foi encerrada, atualizada e aberta de novo, com os mesmos dados.
  const depois = execucao()!;
  assert.ok(!vivo(antes.pid) && vivo(depois.pid) && depois.pid !== antes.pid);
  assert.deepEqual(await painel(), { ...(await painel()), versao: "9.9.9", totalDeProjetos: 1 });
  script("parar");
  assert.match(cli("projeto", "listar").saida, /Cidade Alta/);
  assert.match(script("atualizar").saida, /já está na versão mais recente \(9\.9\.9\)/);
});

test("atualização com defeito: o programa volta à versão anterior e os dados ficam como estavam", () => {
  const boa = git(instalacao, "rev-parse", "HEAD");
  publicar("Versão com defeito", () => {
    const cliDaFonte = path.join(fonte, "src", "interface", "cli.ts");
    writeFileSync(cliDaFonte, `throw new Error("versão com defeito");\n${readFileSync(cliDaFonte, "utf8")}`);
  });
  const r = script("atualizar");
  assert.equal(r.codigo, 1, r.saida);
  assert.match(r.saida, /a nova versão não abriu.*O programa voltou à versão 9\.9\.9 e seus dados estão como antes/s);
  assert.equal(git(instalacao, "rev-parse", "HEAD"), boa);
  assert.equal(git(instalacao, "status", "--porcelain", "--untracked-files=no"), "");
  assert.match(cli("projeto", "listar").saida, /Cidade Alta/);
  assert.equal(cli("situacao").codigo, 0);
});

test("restaurar: volta ao estado de uma cópia, guardando antes o estado atual", () => {
  const copia = copias().find((nome) => nome.endsWith("_pre-atualizacao"))!;
  assert.equal(cli("projeto", "criar", "Projeto posterior", "geral").codigo, 0);
  assert.match(cli("projeto", "listar").saida, /Projeto posterior/);

  const semConfirmar = script("restaurar", copia);
  assert.equal(semConfirmar.codigo, 1);
  assert.match(semConfirmar.saida, /precisa de confirmação/);
  assert.match(cli("projeto", "listar").saida, /Projeto posterior/, "sem confirmação, nada muda");
  assert.equal(script("restaurar", "2020-01-01T00-00-00-000Z_manual", "--sim").codigo, 1);

  const r = script("restaurar", copia, "--sim");
  assert.equal(r.codigo, 0, r.saida);
  assert.match(r.saida, /Cópia restaurada.*_pre-restauracao.*Restauração concluída/s);
  const projetos = cli("projeto", "listar").saida;
  assert.ok(/Cidade Alta/.test(projetos) && !/Projeto posterior/.test(projetos));
  assert.match(script("backup", "--listar").saida, /antes de uma restauração/);
});
