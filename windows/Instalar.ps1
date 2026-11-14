# IA Editora de Video - instalador para Windows 10 e 11.
# Instala o que falta (Node.js, Git, FFmpeg e Python, pelo winget), obtem o programa e
# chama scripts\instalar.mjs, que configura pastas, dependencias, verificacao e atalho.
# Pode ser executado de novo: nada do que ja existe e apagado nem muda de lugar.
# Os textos estao sem acento de proposito, para aparecerem certos em qualquer console.
# Escrito para o Windows PowerShell 5.1, que acompanha o Windows.
#
# Parametros opcionais:
#   -Repositorio <endereco>   de onde baixar o programa, quando o instalador esta sozinho
#   -Ramo <nome>              ramo do repositorio a baixar (padrao: o principal)
#   -Pasta <pasta>            onde colocar o programa baixado
# Qualquer outro argumento e repassado a scripts\instalar.mjs (por exemplo --padrao).
[CmdletBinding(PositionalBinding = $false)]
param(
  [string]$Repositorio = "https://github.com/PauloRiello/IAEditoraVideo.git",
  [string]$Ramo = "",
  [string]$Pasta = "",
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Resto = @()
)

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Dizer($texto) { Write-Host $texto }
function Falhar($mensagem, $oQueFazer) {
  Write-Host ""
  Write-Host "Nao foi possivel concluir: $mensagem" -ForegroundColor Red
  if ($oQueFazer) { Write-Host "O que fazer: $oQueFazer" -ForegroundColor Yellow }
  exit 1
}
function Tem($comando) { return [bool](Get-Command $comando -ErrorAction SilentlyContinue) }

# Programas instalados durante esta execucao so aparecem depois de reler o caminho de busca.
function AtualizarCaminho {
  $separador = [System.IO.Path]::PathSeparator
  $partes = @($env:Path)
  foreach ($alvo in @("Machine", "User")) {
    $valor = [Environment]::GetEnvironmentVariable("Path", $alvo)
    if ($valor) { $partes += $valor }
  }
  $unicas = ($partes -join $separador).Split($separador) | Where-Object { $_ } | Select-Object -Unique
  $env:Path = $unicas -join $separador
}

function InstalarPeloWinget($pacote, $nome) {
  if (-not (Tem "winget")) {
    Falhar "$nome nao esta instalado e o instalador de pacotes do Windows (winget) nao foi encontrado." "instale $nome manualmente, ou instale o 'Instalador de Aplicativo' pela Microsoft Store, e execute este instalador de novo."
  }
  Dizer "  Instalando $nome (o Windows pode pedir autorizacao)..."
  winget install --id $pacote -e --silent --accept-package-agreements --accept-source-agreements | Out-Host
  AtualizarCaminho
}

function Garantir($comando, $pacote, $nome) {
  if (Tem $comando) { Dizer "  [OK]    $nome ja instalado"; return }
  InstalarPeloWinget $pacote $nome
  if (-not (Tem $comando)) {
    Falhar "$nome foi instalado, mas ainda nao aparece para este instalador." "feche esta janela, abra de novo e execute o instalador outra vez."
  }
  Dizer "  [OK]    $nome instalado"
}

# O Windows traz um "python" de mentira que so abre a Microsoft Store: por isso o teste
# executa o programa e confere a resposta, em vez de so procurar o nome.
function TemPython {
  foreach ($candidato in @(@("py", "-3"), @("python"), @("python3"))) {
    $comando = $candidato[0]
    if (-not (Tem $comando)) { continue }
    $argumentos = @()
    if ($candidato.Count -gt 1) { $argumentos = $candidato[1..($candidato.Count - 1)] }
    try {
      $saida = & $comando @argumentos --version 2>&1 | Out-String
      if (($LASTEXITCODE -eq 0) -and ($saida -match "Python 3\.(\d+)") -and ([int]$Matches[1] -ge 11)) { return $true }
    } catch { }
  }
  return $false
}

Dizer "IA Editora de Video - instalador para Windows"
Dizer ""
Dizer "== Programas necessarios =="
Garantir "node" "OpenJS.NodeJS.LTS" "Node.js"
Garantir "git" "Git.Git" "Git"
Garantir "ffmpeg" "Gyan.FFmpeg" "FFmpeg"
if (TemPython) { Dizer "  [OK]    Python ja instalado" }
else {
  InstalarPeloWinget "Python.Python.3.12" "Python"
  if (-not (TemPython)) {
    Falhar "o Python foi instalado, mas ainda nao aparece para este instalador." "feche esta janela, abra de novo e execute o instalador outra vez."
  }
  Dizer "  [OK]    Python instalado"
}

$versaoNode = (& node -p "process.versions.node" | Out-String).Trim()
$partes = $versaoNode.Split(".")
if (($partes.Count -lt 2) -or ([int]$partes[0] -lt 22) -or (([int]$partes[0] -eq 22) -and ([int]$partes[1] -lt 20))) {
  Falhar "o Node.js instalado ($versaoNode) e antigo demais; a aplicacao precisa do 22.20 ou mais recente." "atualize com: winget upgrade OpenJS.NodeJS.LTS  e execute este instalador de novo."
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
} else {
  if (-not $Pasta) { $Pasta = Join-Path (Join-Path $env:LOCALAPPDATA "Programs") "IAEditoraVideo" }
  if (Test-Path (Join-Path $Pasta ".git")) {
    Dizer "  Programa ja baixado em $Pasta"
  } elseif ((Test-Path $Pasta) -and (Get-ChildItem -Force $Pasta | Select-Object -First 1)) {
    Falhar "a pasta $Pasta ja existe e nao esta vazia." "apague-a ou escolha outra com o parametro -Pasta, e execute o instalador de novo."
  } else {
    Dizer "  Baixando o programa para $Pasta ..."
    if ($Ramo) { git clone --branch $Ramo $Repositorio $Pasta } else { git clone $Repositorio $Pasta }
    if ($LASTEXITCODE -ne 0) {
      Falhar "o programa nao pode ser baixado do GitHub." "confira a internet. Se o repositorio for privado, entre na sua conta do GitHub quando o Git pedir. Depois execute o instalador de novo."
    }
  }
}
if (-not (Test-Path (Join-Path (Join-Path $Pasta "scripts") "instalar.mjs"))) {
  Falhar "a pasta $Pasta nao contem o programa completo (falta scripts\instalar.mjs)." "baixe o programa de novo. Se voce informou um ramo, confira o nome."
}

# Sugestoes de pastas para a primeira instalacao. Se ja houver uma instalacao, as pastas dela sao mantidas.
$dados = Join-Path $env:LOCALAPPDATA "IAEditoraVideo"
$biblioteca = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "IA Editora de Video"
Set-Location -LiteralPath $Pasta -ErrorAction Stop
& node (Join-Path "scripts" "instalar.mjs") --sugerir-dados "$dados" --sugerir-biblioteca "$biblioteca" @Resto
exit $LASTEXITCODE
