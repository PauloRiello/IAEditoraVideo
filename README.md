# IA Editora de Vídeo

Editor de vídeo assistido por IA: recebe vídeos brutos, analisa e transcreve o
conteúdo, decide a edição, renderiza e verifica a qualidade antes de exportar.

> **Status:** fundação do projeto. A estrutura e a arquitetura estão definidas;
> o editor ainda não foi implementado.

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
├── scripts/              Utilitários de linha de comando
├── config/               Configurações (sem segredos)
├── tests/                Testes automatizados
├── docs/                 Documentação
└── .claude/              Configuração do Claude Code
```

A arquitetura está detalhada em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Requisitos

| Ferramenta | Versão mínima sugerida | Uso |
|---|---|---|
| Git | 2.40 | Versionamento |
| Python | 3.11 | Pipeline de IA e mídia |
| Node.js + npm | 20 LTS | Ferramentas e interface |
| FFmpeg / ffprobe | 6 | Leitura, corte e renderização de vídeo |
| GPU NVIDIA (opcional) | 8 GB de VRAM | Transcrição e análise locais mais rápidas |

## Uso

Diagnóstico do ambiente (somente leitura):

```bash
bash scripts/diagnostico_ambiente.sh
```

Testes da estrutura e do `.gitignore`:

```bash
python3 -m unittest discover -s tests -v
```

## Regras do repositório

- Vídeos, áudios, renders, pesos de modelos e caches **não** são versionados.
- Credenciais ficam em `.env` (ignorado). Nunca faça commit de chaves ou tokens.
- Arquivos em `Videos Brutos/` são tratados como somente leitura.
