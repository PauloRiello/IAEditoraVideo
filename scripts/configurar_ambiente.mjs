// Configura o ambiente do projeto. Pode ser executado quantas vezes for preciso:
// só instala o que falta e não recria nem apaga o que já existe.
// Funciona em Windows, macOS e Linux. Uso: npm run setup  (ou: node scripts/configurar_ambiente.mjs)

import { existsSync } from "node:fs";
import path from "node:path";
import {
  RAIZ, WINDOWS, binLocal, binVenv, executar, existeComando, pythonDoSistema, resumo, versaoPacote, versoesDeclaradas,
} from "./lib/comum.mjs";

const pendencias = [];
let falhaEssencial = false;
const passo = (texto) => console.log(`\n-> ${texto}`);
const feito = (texto) => console.log(`   [OK]    ${texto}`);
const pendente = (texto) => {
  pendencias.push(texto);
  console.log(`   [AVISO] ${texto}`);
};
const essencial = (texto) => {
  falhaEssencial = true;
  console.log(`   [FALHA] ${texto}`);
};

// 1. Ferramentas do sistema -------------------------------------------------
passo("Ferramentas do sistema");
const [maior, menor] = process.versions.node.split(".").map(Number);
if (maior > 22 || (maior === 22 && menor >= 20)) feito(`Node.js ${process.versions.node}`);
else essencial(`Node.js ${process.versions.node}: instale a versão 22.20 ou mais recente`);

for (const ferramenta of ["git", "ffmpeg", "ffprobe"]) {
  if (existeComando(ferramenta)) feito(`${ferramenta} encontrado`);
  else {
    const dica = WINDOWS ? "winget install Gyan.FFmpeg" : process.platform === "darwin" ? "brew install ffmpeg" : "sudo apt install ffmpeg";
    pendente(`${ferramenta} não está no PATH${ferramenta === "git" ? "" : ` (instale com: ${dica})`}`);
  }
}

// 2. Pacotes npm -------------------------------------------------------------
passo("Pacotes npm (Remotion, HyperFrames, GSAP, TypeScript)");
const faltando = Object.entries(versoesDeclaradas()).filter(([nome, versao]) => versaoPacote(nome) !== versao);
if (faltando.length === 0) {
  feito("Todos os pacotes já estão instalados nas versões declaradas");
} else {
  console.log(`   Instalando: ${faltando.map(([nome]) => nome).join(", ")}`);
  const npm = executar(WINDOWS ? "npm.cmd" : "npm", ["install", "--no-audit", "--no-fund"]);
  if (npm.ok) feito("npm install concluído");
  else essencial(`npm install falhou: ${resumo(npm.erro || npm.saida)}`);
}

// 3. Ambiente Python ---------------------------------------------------------
passo("Ambiente Python (.venv com faster-whisper e yt-dlp)");
const python = binVenv("python");
if (existsSync(python)) {
  feito("Ambiente .venv já existe: mantido");
} else {
  const sistema = pythonDoSistema();
  if (!sistema) {
    essencial("Python 3.11 ou mais recente não encontrado");
  } else {
    const venv = executar(sistema.comando, [...sistema.argumentos, "-m", "venv", path.join(RAIZ, ".venv")]);
    if (venv.ok) feito(`Ambiente .venv criado com Python ${sistema.versao}`);
    else essencial(`Criação do .venv falhou: ${resumo(venv.erro || venv.saida)}`);
  }
}
if (existsSync(python)) {
  const pip = executar(python, ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", "-r", "requirements.txt"]);
  if (pip.ok) feito("Dependências de requirements.txt instaladas");
  else essencial(`pip install falhou: ${resumo(pip.erro || pip.saida)}`);
}

// 4. GPU e aceleração --------------------------------------------------------
passo("GPU e aceleração");
if (!falhaEssencial) {
  const { descrever, detectar, gravar } = await import("./detectar_gpu.mjs");
  let aceleracao = await detectar();

  // GPU NVIDIA: o faster-whisper precisa de cuBLAS e cuDNN para usar CUDA.
  if (aceleracao.whisper.bibliotecasCudaPendentes) {
    console.log("   GPU NVIDIA detectada: instalando cuBLAS e cuDNN para o Whisper (download de cerca de 1 GB; pode levar vários minutos)");
    const cuda = executar(python, ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", "-r", "requirements-gpu-nvidia.txt"]);
    if (!cuda.ok) pendente(`Bibliotecas CUDA não instaladas: ${resumo(cuda.erro || cuda.saida)}`);
    aceleracao = await detectar();
    if (aceleracao.whisper.bibliotecasCudaPendentes) {
      pendente(`Whisper ainda sem acesso à GPU${aceleracao.whisper.motivo ? ` (${aceleracao.whisper.motivo})` : ""}: a transcrição funciona pelo processador, mais devagar. Confira o driver NVIDIA (veja docs/AMBIENTE.md)`);
    }
  }

  const gravado = gravar(aceleracao);
  for (const linha of descrever(aceleracao)) feito(linha);
  feito(gravado ? "Gravado em config/local.aceleracao.json" : "config/local.aceleracao.json manual: preservado");
}

// 5. Navegador do Remotion ---------------------------------------------------
passo("Navegador de render do Remotion (Chrome Headless Shell)");
if (existsSync(binLocal("remotion"))) {
  const navegador = executar(binLocal("remotion"), ["browser", "ensure"], { env: { ...process.env, NODE_USE_ENV_PROXY: "1" } });
  if (navegador.ok) feito("Chrome Headless Shell disponível");
  else pendente("Chrome Headless Shell não pôde ser baixado (rede). O Remotion tentará de novo no primeiro render");
}

// Resumo ---------------------------------------------------------------------
console.log("\n== Resumo da configuração ==");
if (falhaEssencial) console.log("  Há falhas essenciais acima. Corrija e rode `npm run setup` de novo.");
else console.log("  Ambiente configurado.");
for (const item of pendencias) console.log(`  Pendência: ${item}`);
console.log("  Próximo passo: npm run verificar");
process.exitCode = falhaEssencial ? 1 : 0;
