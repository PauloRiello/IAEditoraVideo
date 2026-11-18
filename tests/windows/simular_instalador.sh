#!/bin/bash
# Simula o instalador do Windows (windows/Instalar.ps1) fora do Windows, com o PowerShell
# para Linux ou macOS: programas falsos no caminho de busca e um winget falso que "instala"
# criando o programa. Confere a sintaxe, a compatibilidade com o Windows PowerShell 5.1, os
# caminhos de erro e o comando que cria o atalho.
# Não substitui o teste em um Windows real: cmd.exe, winget, UAC e o Edge não são simulados.
# Uso: bash tests/windows/simular_instalador.sh        (PWSH=/caminho/pwsh se não estiver no PATH)
AQUI=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$AQUI/../.." && pwd)
PWSH=${PWSH:-$(command -v pwsh)}
if [ -z "$PWSH" ] || [ ! -x "$PWSH" ]; then echo "PowerShell (pwsh) não encontrado: simulação não executada."; exit 0; fi
NODE=$(command -v node)
BASE=$(mktemp -d); trap 'rm -rf "$BASE"' EXIT
falhas=0
conferir() { # conferir <descrição> <texto> <padrão esperado> [nao]
  if echo "$2" | grep -qE -- "$3"; then achou=1; else achou=0; fi
  if { [ "$4" = nao ] && [ $achou = 0 ]; } || { [ "$4" != nao ] && [ $achou = 1 ]; }; then echo "  ok     $1"; else echo "  FALHOU $1"; falhas=$((falhas + 1)); fi
}
falso() { printf '#!/bin/bash\n%s\n' "$2" > "$C/$3/$1"; chmod +x "$C/$3/$1"; }

cenario() { # cenario <nome> <onde: programa|sozinho> <programas já instalados> [argumentos do instalador...]
  nome=$1; onde=$2; instalados=$3; shift 3
  C=$BASE/$nome; mkdir -p "$C/bin" "$C/loja" "$C/AppData" "$C/casa/Documents" "$C/programa/windows" "$C/programa/scripts" "$C/sozinho/windows"
  falso node 'if [ "$1" = "-p" ]; then echo "${NODE_FALSO:-22.21.0}"; else echo "NODE CHAMADO em $(pwd):"; for a in "$@"; do echo "  [$a]"; done; exit ${SAIDA_DO_NODE:-0}; fi' loja
  falso git 'echo "GIT: $*" >> "$LOG"; if [ "$1" = "clone" ]; then d="${@: -1}"; /bin/mkdir -p "$d/scripts" "$d/.git"; echo x > "$d/scripts/instalar.mjs"; fi' loja
  falso ffmpeg 'echo ffmpeg' loja
  falso python 'echo "Python 3.12.7"' loja
  falso winget 'echo "WINGET: $*" >> "$LOG"; id=""; while [ $# -gt 0 ]; do [ "$1" = "--id" ] && id=$2; shift; done
case $id in OpenJS.NodeJS.LTS) n=node;; Git.Git) n=git;; Gyan.FFmpeg) n=ffmpeg;; Python.Python.3.12) n=python;; esac
[ -n "$n" ] && /bin/cp "$LOJA/$n" "$BIN/$n"; echo "  (winget falso instalou $id)"' loja
  for n in $instalados; do cp "$C/loja/$n" "$C/bin/$n"; done
  cp "$REPO/windows/Instalar.ps1" "$C/programa/windows/"; cp "$REPO/windows/Instalar.ps1" "$C/sozinho/windows/"
  echo x > "$C/programa/package.json"; echo x > "$C/programa/scripts/instalar.mjs"
  [ -n "$PREPARAR" ] && eval "$PREPARAR"
  touch "$C/chamadas.log"
  SAIDA=$(env -i PATH="$C/bin" LOG="$C/chamadas.log" LOJA="$C/loja" BIN="$C/bin" LOCALAPPDATA="$C/AppData" HOME="$C/casa" NODE_FALSO="$NODE_FALSO" SAIDA_DO_NODE="$SAIDA_DO_NODE" \
    "$PWSH" -NoLogo -NoProfile -File "$C/$onde/windows/Instalar.ps1" "$@" 2>&1; echo "codigo de saida: $?")
  CHAMADAS=$(cat "$C/chamadas.log"); PREPARAR=""; NODE_FALSO=""; SAIDA_DO_NODE=""
  echo "$nome"
}

echo "sintaxe"
conferir "Instalar.ps1 sem erros de sintaxe e sem recursos exclusivos do PowerShell 7" "$("$PWSH" -NoLogo -NoProfile -File "$AQUI/analisar.ps1" -Arquivo "$REPO/windows/Instalar.ps1" 2>&1)" "sintaxe ok"
conferir "arquivos de windows/ só com caracteres ASCII" "$(LC_ALL=C grep -lP '[^\x00-\x7F]' "$REPO"/windows/* || echo nenhum)" "^nenhum$"
conferir "arquivos .cmd com fim de linha do Windows" "$(for f in "$REPO"/windows/*.cmd; do grep -q $'\r$' "$f" || echo "sem CRLF: $f"; done; echo fim)" "^fim$"

cenario "tudo instalado" programa "node git ffmpeg python winget"
conferir "nada é instalado de novo" "$CHAMADAS" "WINGET" nao
conferir "os quatro programas são reconhecidos" "$(echo "$SAIDA" | grep -c 'ja instalado')" "^4$"
conferir "chama scripts/instalar.mjs com as pastas sugeridas" "$SAIDA" "\[--sugerir-dados\]"
conferir "termina com sucesso" "$SAIDA" "codigo de saida: 0"

cenario "sem winget" programa ""
conferir "explica que falta o winget e o que fazer" "$SAIDA" "winget\) nao foi encontrado"
conferir "termina com erro" "$SAIDA" "codigo de saida: 1"

cenario "winget instala o que falta" programa "winget"
for id in OpenJS.NodeJS.LTS Git.Git Gyan.FFmpeg Python.Python.3.12; do conferir "pede $id ao winget" "$CHAMADAS" "install --id $id -e --silent"; done
conferir "segue até o instalador do programa" "$SAIDA" "NODE CHAMADO"

NODE_FALSO=20.11.1 cenario "Node.js antigo" programa "node git ffmpeg python winget"
conferir "recusa o Node.js antigo e diz como atualizar" "$SAIDA" "antigo demais.*|winget upgrade"
conferir "termina com erro" "$SAIDA" "codigo de saida: 1"

PREPARAR='falso python "echo abra a Microsoft Store >&2; exit 9009" bin' cenario "python falso da Microsoft Store" programa "node git ffmpeg winget"
conferir "não confunde o atalho da Store com Python instalado" "$CHAMADAS" "install --id Python.Python.3.12"
PREPARAR='falso python "echo Python 3.8.10" bin' cenario "Python antigo" programa "node git ffmpeg winget"
conferir "Python anterior ao 3.11 não serve" "$CHAMADAS" "install --id Python.Python.3.12"

SAIDA_DO_NODE=1 cenario "falha na instalação do programa" programa "node git ffmpeg python winget"
conferir "repassa o código de erro" "$SAIDA" "codigo de saida: 1"

cenario "instalador sozinho" sozinho "node git ffmpeg python winget"
conferir "baixa o programa pelo Git para a pasta de programas do usuário" "$CHAMADAS" "GIT: clone https://github.com/.*IAEditoraVideo.git .*/AppData/Programs/IAEditoraVideo"
cenario "instalador sozinho, com ramo e opções" sozinho "node git ffmpeg python winget" -Ramo um-ramo --padrao --sem-atalho
conferir "baixa o ramo pedido" "$CHAMADAS" "GIT: clone --branch um-ramo "
conferir "repassa as opções ao instalador do programa" "$(echo "$SAIDA" | tr -d '\n')" "\[--padrao\] *\[--sem-atalho\]"
PREPARAR='mkdir -p "$C/AppData/Programs/IAEditoraVideo/.git" "$C/AppData/Programs/IAEditoraVideo/scripts"; echo x > "$C/AppData/Programs/IAEditoraVideo/scripts/instalar.mjs"' cenario "instalador sozinho, programa já baixado" sozinho "node git ffmpeg python winget"
conferir "não baixa de novo" "$CHAMADAS" "GIT: clone" nao
PREPARAR='mkdir -p "$C/AppData/Programs/IAEditoraVideo"; echo x > "$C/AppData/Programs/IAEditoraVideo/arquivo-de-outra-coisa.txt"' cenario "instalador sozinho, pasta ocupada" sozinho "node git ffmpeg python winget"
conferir "não mexe em pasta que já tem outra coisa" "$SAIDA" "nao esta vazia"
conferir "o arquivo que estava lá continua" "$(ls "$BASE/instalador sozinho, pasta ocupada/AppData/Programs/IAEditoraVideo")" "arquivo-de-outra-coisa.txt"

echo "atalho"
mkdir -p "$BASE/atalho/casa/Desktop"
(cd "$REPO" && "$NODE" -e '
import("./scripts/lib/aplicacao.mjs").then(({ comandoDoAtalho }) => {
  const raiz = "C:\\Users\\Jo\u00e3o D\u0027Avila\\IA Editora";
  const comando = comandoDoAtalho({ node: "C:\\Program Files\\nodejs\\node.exe", iniciar: raiz + "\\scripts\\iniciar.mjs", raiz, icone: raiz + "\\src\\interface\\web\\icone.ico" });
  require("fs").writeFileSync(process.argv[1], Buffer.from(comando, "utf16le").toString("base64"));
});' "$BASE/atalho/comando.b64")
ATALHO=$(HOME="$BASE/atalho/casa" "$PWSH" -NoLogo -NoProfile -File "$AQUI/testar_atalho.ps1" -Arquivo "$BASE/atalho/comando.b64" 2>&1)
conferir "comando do atalho sem erros de sintaxe" "$ATALHO" "sintaxe do comando: ok"
conferir "atalho aponta para o Node e para o inicializador, com espaço, acento e apóstrofo no caminho" "$ATALHO" "\"Arguments\":\"\\\\\"C:\\\\\\\\Users\\\\\\\\João D'Avila\\\\\\\\IA Editora\\\\\\\\scripts\\\\\\\\iniciar.mjs\\\\\"\""
conferir "console minimizado e atalho gravado" "$ATALHO" "\"WindowStyle\":7,\"Salvo\":true"

echo; [ $falhas = 0 ] && echo "Simulação do instalador do Windows: tudo certo." || echo "Simulação do instalador do Windows: $falhas verificação(ões) falharam."
exit $falhas
