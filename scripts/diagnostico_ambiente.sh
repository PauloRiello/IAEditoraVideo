#!/usr/bin/env bash
# Diagnóstico do ambiente de execução (somente leitura — não altera nada).
# Uso: bash scripts/diagnostico_ambiente.sh

secao() { printf '\n== %s ==\n' "$1"; }
versao() {
  if command -v "$1" >/dev/null 2>&1; then
    printf '%-10s %s\n' "$1" "$("$@" 2>&1 | head -n 1)"
  else
    printf '%-10s AUSENTE\n' "$1"
  fi
}

secao "Sistema operacional"
if [ -r /etc/os-release ]; then . /etc/os-release; echo "$PRETTY_NAME"; fi
uname -srm

secao "CPU"
if command -v lscpu >/dev/null 2>&1; then
  lscpu | grep -E 'Model name|^CPU\(s\)|Architecture'
else
  uname -p
fi

secao "Memória RAM"
if command -v free >/dev/null 2>&1; then free -h; else echo "comando 'free' indisponível"; fi

secao "Armazenamento (pasta do projeto)"
df -h .

secao "GPU"
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
else
  echo "nvidia-smi ausente — nenhuma GPU NVIDIA detectada"
fi

secao "Ferramentas"
versao python3 --version
versao pip --version
versao node --version
versao npm --version
versao git --version
versao ffmpeg -version
versao ffprobe -version

if command -v ffmpeg >/dev/null 2>&1; then
  secao "Encoders FFmpeg relevantes"
  ffmpeg -hide_banner -encoders 2>/dev/null | grep -E 'libx264|libx265|nvenc|qsv|videotoolbox|libvpx-vp9| aac ' || echo "nenhum encontrado"
fi
