# Arquitetura inicial — IA Editora de Vídeo

> Status: **estrutura e ambiente prontos**. Nenhuma etapa do editor está implementada.
> Este documento descreve a organização pretendida e as responsabilidades de
> cada parte; decisões marcadas como "em aberto" ainda não foram tomadas.

## 1. Visão geral

O sistema recebe vídeos brutos, entende o conteúdo (imagem, áudio e fala),
decide a edição com apoio de IA, renderiza o resultado e verifica a qualidade
antes de exportar. O que a IA aprende a cada projeto (preferências, feedback,
análises) fica guardado para influenciar as próximas edições.

```
Videos Brutos ─┐
               ├─► ingestion ─► analysis ─► transcription ─► editing ─► rendering ─► quality-control ─► Exportações
Referências ───┘                    │              │             ▲                          │
                                    ▼              ▼             │                          ▼
                              ┌────────────────── IA ───────────────────┐            IA/Feedback
                              │ Analises · Conhecimento · Perfis        │
                              │ Memoria · Aprendizado · Feedback        │
                              └─────────────────────────────────────────┘
```

## 2. Estrutura de pastas

| Pasta | Função | Versionada no Git? |
|---|---|---|
| `Videos Brutos/` | Material original de gravação (entrada) | Só a pasta; conteúdo ignorado |
| `Referências/` | Vídeos e materiais de referência de estilo | Só a pasta; conteúdo ignorado |
| `Exportações/` | Vídeos finais renderizados (saída) | Só a pasta; conteúdo ignorado |
| `IA/` | Estado e conhecimento da IA (ver seção 4) | Sim (texto/JSON; mídia e pesos ignorados) |
| `Pipeline/` | Etapas do processamento (ver seção 3) | Sim |
| `src/` | Código-fonte central: orquestração e módulos compartilhados | Sim |
| `scripts/` | Utilitários de linha de comando (diagnóstico, manutenção) | Sim |
| `config/` | Configurações do projeto (sem segredos) | Sim |
| `tests/` | Testes automatizados | Sim |
| `docs/` | Documentação | Sim |
| `.claude/` | Configuração do Claude Code para este repositório | Sim (exceto `settings.local.json`) |

## 3. Pipeline

Cada etapa recebe a saída da anterior e produz um artefato bem definido. As
etapas devem ser independentes e reexecutáveis: refazer a edição não deve
exigir nova transcrição.

| Etapa | Pasta | Responsabilidade | Entrada → Saída |
|---|---|---|---|
| 1. Ingestão | `Pipeline/ingestion/` | Descobrir arquivos, validar, extrair metadados (codec, resolução, fps, duração), gerar proxies | Vídeo bruto → registro de mídia |
| 2. Análise | `Pipeline/analysis/` | Detectar cenas/cortes, silêncios, qualidade de imagem e áudio | Registro de mídia → análise por trecho |
| 3. Transcrição | `Pipeline/transcription/` | Converter fala em texto com marcação de tempo | Áudio → transcrição temporizada |
| 4. Edição | `Pipeline/editing/` | Decidir cortes, ordem e ritmo; gerar a lista de decisões de edição | Análise + transcrição + perfil → plano de edição |
| 5. Renderização | `Pipeline/rendering/` | Executar o plano de edição e gerar o vídeo | Plano de edição → vídeo renderizado |
| 6. Controle de qualidade | `Pipeline/quality-control/` | Conferir duração, sincronia, níveis de áudio, quadros pretos, conformidade com o perfil | Vídeo renderizado → aprovação ou relatório de problemas |

## 4. Camada de IA

| Pasta | Conteúdo |
|---|---|
| `IA/Memoria/` | Histórico persistente entre sessões: projetos anteriores e decisões tomadas |
| `IA/Aprendizado/` | Padrões derivados do histórico e do feedback (o que funcionou e o que não funcionou) |
| `IA/Perfis/` | Perfis de edição: estilo, ritmo, formato e plataforma de destino |
| `IA/Feedback/` | Avaliações humanas e resultados do controle de qualidade de cada exportação |
| `IA/Analises/` | Resultados de análise de vídeos brutos e de referências |
| `IA/Conhecimento/` | Base de conhecimento: regras de edição, boas práticas, guias de estilo |

Ciclo de melhoria: `Feedback` e `Analises` alimentam `Aprendizado`, que
atualiza `Perfis` e `Memoria`, usados pela etapa de edição no projeto seguinte.

## 5. Princípios

- **Originais são somente leitura.** Nada em `Videos Brutos/` é modificado; o
  processamento trabalha sobre cópias ou proxies.
- **Mídia fora do Git.** Vídeos, renders, pesos de modelos e caches nunca são
  versionados (ver `.gitignore`).
- **Segredos fora do Git.** Credenciais ficam em `.env` ou em `config/secrets/`,
  ambos ignorados. Um `.env.example` sem valores pode ser versionado.
- **Etapas desacopladas.** Cada etapa do pipeline se comunica por arquivos de
  dados, não por chamadas diretas entre etapas.

## 6. Tecnologias adotadas

| Camada | Tecnologia | Observação |
|---|---|---|
| Composição e render | Remotion (React) e HyperFrames (HTML) | Dois motores disponíveis; a escolha por tipo de vídeo fica para a etapa de edição |
| Animação | GSAP | Linha do tempo pausada, posicionada quadro a quadro |
| Mídia | FFmpeg e FFprobe | Encoder escolhido pela detecção de GPU |
| Transcrição | faster-whisper, local | Implementação do Whisper sem PyTorch; CPU ou GPU NVIDIA |
| Download de referências | yt-dlp | Configurado em `config/yt-dlp.conf` |
| Linguagens | TypeScript (composições) e Python (IA e mídia) | Scripts de ambiente em Node.js, para rodar em qualquer sistema |

Detalhes de instalação e uso: [AMBIENTE.md](AMBIENTE.md). Versões: [VERSOES.md](VERSOES.md).

## 7. Decisões em aberto

- Qual motor de render usar em cada tipo de vídeo (Remotion, HyperFrames ou ambos).
- Modelo do Whisper para produção (o teste usa o `tiny`; modelos maiores são mais precisos e mais lentos).
- Formato do plano de edição (EDL, OpenTimelineIO ou JSON próprio).
