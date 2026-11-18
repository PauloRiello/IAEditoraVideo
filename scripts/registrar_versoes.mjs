// Registra em docs/VERSOES.md as versões instaladas nesta máquina.
// Uso: npm run versoes
import { existsSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  RAIZ, WINDOWS, binLocal, binVenv, executar, lerAceleracao, lerJson, versaoPacote, versoesDeclaradas,
} from "./lib/comum.mjs";

const primeiraLinha = (r) => (r.ok ? r.saida.split(/\r?\n/)[0] : "não encontrado");
const tabela = (cabecalho, linhas) =>
  [`| ${cabecalho.join(" | ")} |`, `|${cabecalho.map(() => "---").join("|")}|`, ...linhas.map((l) => `| ${l.join(" | ")} |`)].join("\n");

// Sistema
const python = binVenv("python");
const sistema = [
  ["Sistema operacional", `${os.type()} ${os.release()} (${process.platform}-${process.arch})`],
  ["CPU", `${os.cpus()[0]?.model ?? "?"} × ${os.cpus().length}`],
  ["Memória RAM", `${(os.totalmem() / 1024 ** 3).toFixed(1)} GB`],
  ["Node.js", process.versions.node],
  ["npm", primeiraLinha(executar(WINDOWS ? "npm.cmd" : "npm", ["--version"]))],
  ["Python (.venv)", primeiraLinha(executar(python, ["--version"])).replace("Python ", "")],
  ["pip (.venv)", primeiraLinha(executar(python, ["-m", "pip", "--version"])).split(" from ")[0].replace("pip ", "")],
  ["Git", primeiraLinha(executar("git", ["--version"])).replace("git version ", "")],
  ["FFmpeg (sistema)", primeiraLinha(executar("ffmpeg", ["-version"])).split(" Copyright")[0].replace("ffmpeg version ", "")],
  ["FFprobe (sistema)", primeiraLinha(executar("ffprobe", ["-version"])).split(" Copyright")[0].replace("ffprobe version ", "")],
  ["FFmpeg (embutido no Remotion)", primeiraLinha(executar(binLocal("remotion"), ["ffmpeg", "-version"])).split(" Copyright")[0].replace("ffmpeg version ", "")],
];

// Pacotes npm declarados
const npm = Object.entries(versoesDeclaradas())
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([nome, declarada]) => [nome, declarada, versaoPacote(nome) ?? "não instalado"]);

// Pacotes Python
const pip = executar(python, ["-m", "pip", "list", "--format=json", "--disable-pip-version-check"]);
const pacotesPython = pip.ok ? JSON.parse(pip.saida) : [];
const diretos = ["faster-whisper", "yt-dlp", "yt-dlp-ejs", "ctranslate2", "av", "onnxruntime", "tokenizers", "huggingface_hub"];
const versaoPython = (nome) => pacotesPython.find((p) => p.name.toLowerCase().replace(/_/g, "-") === nome.replace(/_/g, "-"))?.version ?? "não instalado";

// Skills
const trava = path.join(RAIZ, "skills-lock.json");
const skills = existsSync(trava) ? Object.entries(lerJson(trava).skills) : [];
const porOrigem = {};
for (const [nome, dados] of skills) (porOrigem[`${dados.source}${dados.ref ? ` @ ${dados.ref}` : ""}`] ??= []).push(nome);

// Aceleração
const a = lerAceleracao();

const documento = `# Versões instaladas

> Arquivo gerado por \`npm run versoes\` em ${new Date().toISOString().slice(0, 10)}. Não edite à mão.
> Reflete a máquina em que o comando foi executado.

## Sistema e ferramentas

${tabela(["Item", "Versão"], sistema)}

## Pacotes npm

A árvore completa, com dependências indiretas, está travada em \`package-lock.json\`.

${tabela(["Pacote", "Declarada", "Instalada"], npm)}

## Pacotes Python

${tabela(["Pacote", "Instalada"], diretos.map((nome) => [nome, versaoPython(nome)]))}

<details>
<summary>Lista completa do .venv (${pacotesPython.length} pacotes)</summary>

\`\`\`
${pacotesPython.map((p) => `${p.name}==${p.version}`).join("\n")}
\`\`\`

</details>

## Agent Skills (Claude Code)

Instaladas em \`.claude/skills\` e travadas em \`skills-lock.json\`.

${tabela(["Origem", "Qtd.", "Skills"], Object.entries(porOrigem).map(([origem, nomes]) => [origem, String(nomes.length), nomes.join(", ")]))}

## Aceleração detectada

${
  a
    ? tabela(["Item", "Valor"], [
        ["GPU", a.gpu ? `${a.gpu.nome} (${a.gpu.fabricante})` : "nenhuma"],
        ["FFmpeg — encoder H.264", a.ffmpeg.encoderH264],
        ["Whisper — device / compute_type", `${a.whisper.device} / ${a.whisper.computeType}`],
        ["Remotion — hardwareAcceleration", a.remotion.hardwareAcceleration],
        ["HyperFrames — codificação por GPU", a.hyperframes.gpuEncoding ? "ativada" : "desativada"],
      ])
    : "Ainda não detectada. Rode `npm run gpu`."
}
`;

const destino = path.join(RAIZ, "docs", "VERSOES.md");
writeFileSync(destino, documento);
console.log(`Versões registradas em ${path.relative(RAIZ, destino)}`);
