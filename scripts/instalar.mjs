// Instala a IA Editora de Vídeo neste computador: escolhe as pastas de dados e de vídeos,
// instala as dependências, verifica as ferramentas, prepara o banco e cria o atalho.
// Pode ser executado de novo sem risco: nada do que já existe é apagado ou sobrescrito.
// Uso: npm run instalar   (no Windows: windows\Instalar.cmd, que antes instala Node, Python, FFmpeg e Git)
// Opções: --dados <pasta>  --biblioteca <pasta>   define as pastas (vale mais que a escolha anterior)
//         --sugerir-dados <pasta>  --sugerir-biblioteca <pasta>   sugestão para a primeira instalação
//         --padrao (não pergunta nada)
//         --sem-atalho  --sem-verificar  --sem-configurar (pula a instalação de dependências)

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { cli, comandoDoAtalho, dizer, falhar } from "./lib/aplicacao.mjs";
import { RAIZ, WINDOWS, lerJson } from "./lib/comum.mjs";

const argumentos = process.argv.slice(2);
const opcao = (nome) => (argumentos.includes(`--${nome}`) ? argumentos[argumentos.indexOf(`--${nome}`) + 1] : null);
const tem = (nome) => argumentos.includes(`--${nome}`);
const arquivoDaInstalacao = path.join(RAIZ, "config", "local.instalacao.json");
const passo = (texto) => dizer(`\n== ${texto} ==`);

dizer("IA Editora de Vídeo — instalação");
dizer(`Pasta do programa: ${RAIZ}`);
const [maior, menor] = process.versions.node.split(".").map(Number);
if (maior < 22 || (maior === 22 && menor < 20)) falhar(`o Node.js instalado (${process.versions.node}) é antigo demais.`, "instale o Node.js 22.20 ou mais recente (no Windows: winget install OpenJS.NodeJS.LTS) e execute a instalação de novo.");

// 1. Pastas -------------------------------------------------------------------
passo("1 de 5: pastas");
const existente = existsSync(arquivoDaInstalacao) ? lerJson(arquivoDaInstalacao) : {};
const padrao = {
  dados: path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), ".local", "share"), "IAEditoraVideo"),
  biblioteca: path.join(os.homedir(), "Documents", "IA Editora de Vídeo"),
};
// Ordem de prioridade: pasta pedida agora; pasta escolhida em instalação anterior; sugestão do instalador; padrão.
// Assim, reinstalar ou reparar nunca troca de lugar os dados e os vídeos que já existem.
const escolha = {
  dados: opcao("dados") ?? existente.dados ?? opcao("sugerir-dados") ?? padrao.dados,
  biblioteca: opcao("biblioteca") ?? existente.biblioteca ?? opcao("sugerir-biblioteca") ?? padrao.biblioteca,
};
if (existente.dados || existente.biblioteca) dizer("Instalação anterior encontrada: as pastas escolhidas antes foram mantidas.");
else if (!tem("padrao") && !opcao("biblioteca") && process.stdin.isTTY) {
  const leitor = createInterface({ input: process.stdin, output: process.stdout });
  dizer("Os vídeos e as exportações ficam em uma pasta sua, separada do programa.");
  dizer("Escolha um disco com bastante espaço livre. Aperte Enter para aceitar a sugestão.");
  const biblioteca = (await leitor.question(`Pasta dos vídeos e exportações [${escolha.biblioteca}]: `)).trim().replace(/^"(.*)"$/, "$1");
  if (biblioteca) escolha.biblioteca = path.resolve(biblioteca);
  leitor.close();
}
for (const [nome, pasta] of Object.entries(escolha)) {
  if (!path.isAbsolute(pasta)) falhar(`a pasta de ${nome} precisa ser um caminho completo (recebido: ${pasta}).`, "informe o caminho desde a letra do disco, por exemplo D:\\Videos\\IA Editora.");
  try {
    mkdirSync(pasta, { recursive: true });
  } catch (erro) {
    falhar(`a pasta ${pasta} não pôde ser criada (${erro.message}).`, "escolha outra pasta ou confira as permissões.");
  }
}
mkdirSync(path.dirname(arquivoDaInstalacao), { recursive: true });
writeFileSync(arquivoDaInstalacao, `${JSON.stringify(escolha, null, 2)}\n`);
dizer(`Dados da aplicação (banco, configurações, cópias de segurança): ${escolha.dados}`);
dizer(`Vídeos brutos, referências e exportações: ${escolha.biblioteca}`);

// 2. Dependências --------------------------------------------------------------
passo("2 de 5: dependências (pode levar vários minutos na primeira vez)");
if (tem("sem-configurar")) dizer("Etapa pulada a pedido (--sem-configurar).");
else {
  const setup = spawnSync(process.execPath, [path.join(RAIZ, "scripts", "configurar_ambiente.mjs")], { cwd: RAIZ, stdio: "inherit", windowsHide: true });
  if (setup.status !== 0) falhar("as dependências não foram instaladas por completo.", "leia as linhas marcadas com [FALHA] acima, corrija (em geral: instalar Python ou FFmpeg, ou conferir a internet) e execute a instalação de novo.");
}

// 3. Verificação das ferramentas ---------------------------------------------------
passo("3 de 5: verificação das ferramentas");
let pendencias = false;
if (tem("sem-verificar")) dizer("Etapa pulada a pedido (--sem-verificar).");
else {
  const verificacao = spawnSync(process.execPath, [path.join(RAIZ, "scripts", "verificar", "todos.mjs"), "--produto"], { cwd: RAIZ, stdio: "inherit", windowsHide: true });
  pendencias = verificacao.status !== 0;
  if (pendencias) dizer("\nHá ferramentas com problema (veja acima). A aplicação abre mesmo assim, mas o recurso correspondente pode não funcionar.");
}

// 4. Banco e pastas da aplicação -----------------------------------------------------
passo("4 de 5: banco de dados e pastas");
const abertura = cli(["situacao"]);
if (!abertura.ok) falhar(`a aplicação não abriu (${(abertura.erro || abertura.saida).split("\n").slice(-1)[0]}).`, "execute a instalação de novo. Se continuar, envie esta mensagem a quem mantém o programa.");
dizer(abertura.saida.split("\n").filter((linha) => /^(Esquema|Projetos|Dados|Aviso)/i.test(linha.trim())).join("\n") || "Banco pronto.");

// 5. Atalho -------------------------------------------------------------------------------
passo("5 de 5: atalho");
const iniciar = path.join(RAIZ, "scripts", "iniciar.mjs");
if (tem("sem-atalho")) dizer("Etapa pulada a pedido (--sem-atalho).");
else if (WINDOWS) {
  // Atalho na Área de Trabalho e no Menu Iniciar, com a janela do console minimizada.
  const comando = comandoDoAtalho({ node: process.execPath, iniciar, raiz: RAIZ, icone: path.join(RAIZ, "src", "interface", "web", "icone.ico") });
  // O comando vai codificado: assim aspas e espaços nos caminhos não se perdem na passagem para o PowerShell.
  const atalho = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(comando, "utf16le").toString("base64")], { encoding: "utf8", windowsHide: true });
  if (atalho.status === 0) dizer("Atalho \"IA Editora de Video\" criado na Área de Trabalho e no Menu Iniciar.");
  else dizer(`O atalho não pôde ser criado (${(atalho.stderr || "").trim().split("\n")[0]}). Abra a aplicação por windows\\Iniciar.cmd.`);
} else if (process.platform === "linux") {
  const pasta = path.join(os.homedir(), ".local", "share", "applications");
  try {
    mkdirSync(pasta, { recursive: true });
    writeFileSync(path.join(pasta, "ia-editora-video.desktop"), [
      "[Desktop Entry]", "Type=Application", "Name=IA Editora de Vídeo", "Comment=Editor de vídeo assistido por IA",
      `Exec="${process.execPath}" "${iniciar}"`, `Path=${RAIZ}`, `Icon=${path.join(RAIZ, "src", "interface", "web", "icone.svg")}`, "Terminal=false", "Categories=AudioVideo;Video;", "",
    ].join("\n"));
    dizer("Atalho criado no menu de aplicativos.");
  } catch (erro) {
    dizer(`O atalho não pôde ser criado (${erro.message}). Abra a aplicação com: npm run iniciar`);
  }
} else dizer("Neste sistema o atalho não é criado. Abra a aplicação com: npm run iniciar");

dizer("\nInstalação concluída.");
dizer(WINDOWS ? "Para abrir: use o atalho \"IA Editora de Video\" (ou windows\\Iniciar.cmd)." : "Para abrir: npm run iniciar");
if (pendencias) dizer("Atenção: há pendências na verificação das ferramentas, listadas acima.");
