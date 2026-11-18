# Ambiente de desenvolvimento

Como instalar, verificar e usar as ferramentas do projeto. As versões instaladas
ficam em [VERSOES.md](VERSOES.md).

## Pré-requisitos (instalação manual)

| Ferramenta | Versão | Windows | macOS | Linux (Debian/Ubuntu) |
|---|---|---|---|---|
| Node.js + npm | 22.20 ou mais recente | `winget install OpenJS.NodeJS.LTS` | `brew install node` | [nodejs.org](https://nodejs.org) |
| Python | 3.11 ou mais recente | `winget install Python.Python.3.13` | `brew install python` | `sudo apt install python3 python3-venv` |
| FFmpeg + FFprobe | 6 ou mais recente | `winget install Gyan.FFmpeg` | `brew install ffmpeg` | `sudo apt install ffmpeg` |
| Git | 2.40 ou mais recente | `winget install Git.Git` | `brew install git` | `sudo apt install git` |

No Linux, o navegador de render exige bibliotecas de sistema: veja a lista em
<https://www.remotion.dev/docs/miscellaneous/linux-dependencies>.

## Instalação

```bash
npm install
```

```bash
npm run setup
```

`npm run setup` pode ser repetido à vontade. Ele só instala o que falta:

1. confere Node.js, Git, FFmpeg e FFprobe;
2. instala os pacotes npm que não estiverem na versão declarada;
3. cria o ambiente Python `.venv` se não existir (nunca recria) e instala `requirements.txt`;
4. detecta a GPU e grava `config/local.aceleracao.json`;
5. baixa o navegador de render do Remotion (Chrome Headless Shell).

## Verificação

```bash
npm run verificar
```

Executa os 12 testes abaixo e mostra um resumo. Cada um também roda sozinho:

| Comando | O que testa |
|---|---|
| `npm run verificar:node` | Versão do Node.js e pacotes npm nas versões declaradas |
| `npm run verificar:python` | Python do sistema, `.venv`, pip e conflitos de dependências |
| `npm run verificar:typescript` | Versão do `tsc` e checagem de tipos do projeto |
| `npm run verificar:ffmpeg` | Encoders e codificação real de vídeo H.264 com áudio AAC |
| `npm run verificar:ffprobe` | Leitura de codec, resolução, taxa de quadros e duração |
| `npm run verificar:gpu` | Detecção da GPU e teste real de cada encoder de hardware |
| `npm run verificar:gsap` | Versão e animação controlada por tempo (`seek`) |
| `npm run verificar:remotion` | Render real de 1 s (React + GSAP) e conferência do MP4 |
| `npm run verificar:hyperframes` | Lint e render real de 1 s (HTML + GSAP) e conferência do MP4 |
| `npm run verificar:whisper` | Transcrição real de fala sintética, com tempo por palavra |
| `npm run verificar:yt-dlp` | Download real de servidor local e consulta online ao YouTube |
| `npm run verificar:skills` | Agent Skills instaladas e válidas |

`[AVISO]` indica limitação da máquina ou da rede, não defeito da instalação.
`npm run versoes` regrava [VERSOES.md](VERSOES.md).

## Aceleração por GPU

`npm run gpu` detecta a placa e testa cada encoder com uma codificação real — um
encoder listado pelo FFmpeg sem hardware compatível é descartado. O resultado vai
para `config/local.aceleracao.json` (por máquina, fora do Git):

| Ferramenta | Sem GPU | Com GPU |
|---|---|---|
| FFmpeg | `libx264` | `h264_nvenc`, `h264_videotoolbox`, `h264_qsv`, `h264_amf` ou `h264_vaapi` |
| Whisper | `cpu` / `int8` | `cuda` / `float16` (somente NVIDIA) |
| Remotion | `hardwareAcceleration: disable` | `if-possible` (NVENC ou VideoToolbox) |
| HyperFrames | sem `--gpu` | `--gpu` |

- `remotion.config.ts` lê esse arquivo automaticamente.
- Ter a placa e o driver não basta: o Whisper só usa a GPU se o cuBLAS e o cuDNN
  carregarem. A detecção confere isso de verdade (`Pipeline/transcription/gpu.py`), no
  Windows e no Linux, e torna visíveis as bibliotecas instaladas pelo pip. Se a placa não
  puder ser usada, a transcrição é feita pelo processador, com aviso no registro.
- Com GPU NVIDIA, o setup instala cuBLAS e cuDNN (`requirements-gpu-nvidia.txt`). No
  Linux pode ser preciso apontar `LD_LIBRARY_PATH` para essas bibliotecas, conforme o
  [README do faster-whisper](https://github.com/SYSTRAN/faster-whisper#gpu).
- Para fixar valores à mão, edite o arquivo e acrescente `"manual": true`: a detecção
  deixa de sobrescrevê-lo.

## Uso das ferramentas

| Ferramenta | Comando |
|---|---|
| Remotion (prévia) | `npx remotion studio <entrada>` |
| Remotion (render) | `npx remotion render <entrada> <composição> <saída.mp4>` |
| HyperFrames (prévia) | `npx hyperframes preview <pasta>` |
| HyperFrames (render) | `npx hyperframes render <pasta> -o <saída.mp4>` |
| yt-dlp | `.venv/bin/yt-dlp --config-locations config/yt-dlp.conf <URL>` |
| Whisper | `.venv/bin/python` com `faster_whisper.WhisperModel` |

No Windows, os executáveis do Python ficam em `.venv\Scripts\` em vez de `.venv/bin/`.

## Agent Skills do Claude Code

Ficam em `.claude/skills` (arquivos reais, sem links simbólicos, para funcionar no
Windows) e estão travadas em `skills-lock.json`. O Claude Code as carrega ao abrir o projeto.

- **Remotion** — 13 skills de `remotion-dev/skills`. Atualizar: `npx remotion skills update`.
- **HyperFrames** — as 6 skills do conjunto principal, de `heygen-com/hyperframes` na
  versão do pacote instalado. Atualizar: reinstale com `npx skills add` apontando para a
  nova versão; `npx hyperframes skills update` instala no perfil do usuário, não no projeto.

## Observações

- **Telemetria do HyperFrames.** A CLI coleta dados de uso por padrão. Os scripts deste
  projeto a desligam (`HYPERFRAMES_NO_TELEMETRY=1`). Para desligar também no uso direto:
  `npx hyperframes telemetry disable`.
- **GSAP no HyperFrames.** O modelo padrão carrega o GSAP de uma CDN. Para render sem
  internet, copie `node_modules/gsap/dist/gsap.min.js` para o projeto, como faz o teste.
- **Licença do Remotion.** Gratuito para indivíduos e empresas de até 3 pessoas; acima
  disso exige licença paga. Consulte <https://remotion.dev/license>.
- **YouTube.** O download exige um runtime de JavaScript (configurado para o Node.js) e
  pode ser recusado em IPs de servidores.
