# IA Editora de Vídeo

Editor de vídeo assistido por IA: recebe vídeos brutos, analisa e transcreve o
conteúdo, decide a edição, renderiza e verifica a qualidade antes de exportar.

> **Status:** estrutura e ambiente de desenvolvimento prontos e verificados.
> O editor ainda não foi implementado.

## Estrutura

```
IAEditoraVideo/
├── Videos Brutos/        Material original (conteúdo fora do Git)
├── Referências/          Referências de estilo (conteúdo fora do Git)
├── Exportações/          Vídeos finais (conteúdo fora do Git)
├── IA/
│   ├── Memoria/          Histórico persistente entre projetos
│   ├── Aprendizado/      Padrões aprendidos com histórico e feedback
│   ├── Perfis/           Perfis de edição (estilo, ritmo, plataforma)
│   ├── Feedback/         Avaliações humanas e de controle de qualidade
│   ├── Analises/         Resultados de análise de vídeos
│   └── Conhecimento/     Regras e boas práticas de edição
├── Pipeline/
│   ├── ingestion/        1. Entrada, validação e metadados
│   ├── analysis/         2. Cenas, silêncios, qualidade
│   ├── transcription/    3. Fala → texto temporizado
│   ├── editing/          4. Decisões de corte e plano de edição
│   ├── rendering/        5. Geração do vídeo
│   └── quality-control/  6. Verificação antes de exportar
├── src/                  Código-fonte central
├── scripts/              Setup, detecção de GPU e verificadores
├── config/               Configurações (sem segredos)
├── tests/                Testes automatizados e composições de teste
├── docs/                 Documentação
├── .claude/skills/       Agent Skills do Remotion e do HyperFrames
├── package.json          Dependências Node.js e comandos npm
├── requirements.txt      Dependências Python
├── tsconfig.json         Configuração do TypeScript
└── remotion.config.ts    Configuração do Remotion
```

A arquitetura está detalhada em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Ferramentas

| Ferramenta | Função |
|---|---|
| Remotion | Composição e render de vídeo com React |
| HyperFrames | Composição e render de vídeo com HTML |
| GSAP | Animação, usada nos dois motores |
| FFmpeg / FFprobe | Corte, codificação e leitura de dados de mídia |
| Whisper (faster-whisper) | Transcrição de fala com marcação de tempo |
| yt-dlp | Download de vídeos de referência |
| TypeScript | Tipagem do código |

Versões instaladas: [docs/VERSOES.md](docs/VERSOES.md).

## Como executar

Requer Node.js 22.20+, Python 3.11+, FFmpeg e Git já instalados. Funciona em
Windows, macOS e Linux.

```bash
npm install
```

```bash
npm run setup
```

```bash
npm run verificar
```

Instalação, verificação, aceleração por GPU e uso de cada ferramenta estão em
[docs/AMBIENTE.md](docs/AMBIENTE.md).

## Regras do repositório

- Vídeos, áudios, renders, pesos de modelos e caches **não** são versionados.
- Credenciais ficam em `.env` (ignorado). Nunca faça commit de chaves ou tokens.
- Arquivos em `Videos Brutos/` são tratados como somente leitura.
