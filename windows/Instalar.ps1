# IA Editora de Video - instalador para Windows 10 e 11.
# Instala o que falta (Node.js, Python, FFmpeg e Git, pelo winget), obtem o programa e
# chama scripts\instalar.mjs, que configura pastas, dependencias, verificacao e atalho.
# Pode ser executado de novo: nada do que ja existe e apagado.
# Os textos estao sem acento de proposito, para aparecerem certos em qualquer console.
param(
  [string]$Repositorio = "https://github.com/PauloRiello/IAEditoraVideo.git",
  [string]$Pasta = (Join-Path $env:LOCALAPPDATA "Programs\IAEditoraVideo")
)
$ErrorActionPreference = "Stop"

function Dizer($texto) { Write-Host $texto }
function Falhar($mensagem, $oQueFazer) {
  Write-Host ""
  Write-Host "Nao foi possivel concluir: $mensagem" -ForegroundColor Red
  if ($oQueFazer) { Write-Host "O que fazer: $oQueFazer" -ForegroundColor Yellow }
  exit 1
}
function Tem($comando) { return [bool](Get-Command $comando -ErrorAction SilentlyContinue) }
function AtualizarCaminho {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}
function Garantir($comando, $pacote, $nome) {
  if (Tem $comando) { Dizer "  [OK]    $nome ja instalado"; return }
  if (-not (Tem "winget")) {
    Falhar "$nome nao esta instalado e o instalador de pacotes do Windows (winget) nao foi encontrado." "instale $nome manualmente, ou instale o 'Instalador de Aplicativo' pela Microsoft Store, e execute este instalador de novo."
  }
  Dizer "  Instalando $nome (pode pedir autorizacao do Windows)..."
  winget install --id $pacote -e --silent --accept-package-agreements --accept-source-agreements | Out-Host
  AtualizarCaminho
  if (-not (Tem $comando)) {
    Falhar "$nome foi instalado, mas ainda nao aparece para este instalador." "feche esta janela, abra de novo e execute o instalador outra vez."
  }
  Dizer "  [OK]    $nome instalado"
}

Dizer "IA Editora de Video - instalador para Windows"
Dizer ""
Dizer "== Programas necessarios =="
Garantir "node" "OpenJS.NodeJS.LTS" "Node.js"
Garantir "git" "Git.Git" "Git"
Garantir "ffmpeg" "Gyan.FFmpeg" "FFmpeg"
if (-not ((Tem "py") -or (Tem "python"))) { Garantir "python" "Python.Python.3.12" "Python" } else { Dizer "  [OK]    Python ja instalado" }

$versaoNode = (node -p "process.versions.node")
$partes = $versaoNode.Split(".")
if (([int]$partes[0] -lt 22) -or (([int]$partes[0] -eq 22) -and ([int]$partes[1] -lt 20))) {
  Falhar "o Node.js instalado ($versaoNode) e antigo demais." "atualize com: winget upgrade OpenJS.NodeJS.LTS  e execute este instalador de novo."
}

Dizer ""
Dizer "== Programa =="
$aqui = Split-Path -Parent $PSScriptRoot
if (Test-Path (Join-Path $aqui "package.json")) {
  # O instalador esta dentro de uma copia do programa (pasta baixada ou clonada): instala nela mesma.
  $Pasta = $aqui
  Dizer "  Usando o programa desta pasta: $Pasta"
  if (-not (Test-Path (Join-Path $Pasta ".git"))) {
    Dizer "  Esta copia nao veio do Git. Para atualizar depois, baixe a nova versao e execute o instalador de novo."
  }
} elseif (Test-Path (Join-Path $Pasta ".git")) {
  Dizer "  Programa ja instalado em $Pasta"
} else {
  Dizer "  Baixando o programa para $Pasta ..."
  git clone $Repositorio $Pasta
  if ($LASTEXITCODE -ne 0) {
    Falhar "o programa nao pode ser baixado do GitHub." "confira a internet. Se o repositorio for privado, entre na sua conta do GitHub quando o Git pedir. Depois execute o instalador de novo."
  }
}

$documentos = [Environment]::GetFolderPath("MyDocuments")
$dados = Join-Path $env:LOCALAPPDATA "IAEditoraVideo"
$biblioteca = Join-Path $documentos "IA Editora de Video"
Set-Location $Pasta
node scripts\instalar.mjs --dados "$dados" --biblioteca "$biblioteca" @args
exit $LASTEXITCODE
