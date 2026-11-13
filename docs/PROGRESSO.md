# Registro de progresso

Uma entrada por etapa concluída. A próxima etapa só começa com autorização.

## Etapa 1 — Estrutura do projeto ✅

- Pastas de mídia, `IA/`, `Pipeline/`, `src/`, `scripts/`, `config/`, `tests/`, `docs/`.
- `.gitignore` para mídia pesada, renders, caches, temporários e credenciais.
- **Testes:** estrutura e regras do `.gitignore` (`python3 -m unittest discover -s tests`).

## Etapa 2 — Ambiente e ferramentas ✅

- Remotion, HyperFrames, GSAP, TypeScript, faster-whisper e yt-dlp instalados com versões fixas.
- 19 Agent Skills (Remotion e HyperFrames) em `.claude/skills`, para uso no desenvolvimento.
- Detecção de GPU com teste real de encoders; setup repetível e compatível com Windows.
- **Testes:** 12 verificadores (`npm run verificar`), todos passando.
- **Pendências:** aceleração por GPU e execução em Windows não testadas (servidor Linux sem GPU).

## Etapa 3 — Arquitetura central ✅

- Arquitetura em camadas definida e documentada em [ARQUITETURA.md](ARQUITETURA.md).
- Implementado: núcleo (`Aplicacao`, `Orquestrador`), serviços (projetos, memória,
  aprendizado, perfis, provedores de IA, recursos), infraestrutura (SQLite com
  migrações e backup, caminhos, configurações) e interface de linha de comando.
- Perfis `geral`, `fivem` e `redm` como dados configuráveis.
- Camada de provedores de IA sem fornecedor obrigatório, com adaptador para servidores
  locais e APIs compatíveis com OpenAI.
- **Testes:** 10 testes de unidade (`npm test`), todos passando, incluindo abertura sem
  provedor, persistência após fechamento, backup, reexecução parcial do pipeline,
  decisão GPU/CPU por VRAM e independência do Claude.
- **Pendências:**
  - Etapas do pipeline: só os contratos existem.
  - Interface gráfica, instalador, atualização automática e restauração de backup.
  - Provedor de transcrição local (ligação do Whisper à aplicação).
  - Detecção de GPU ainda depende de `npm run gpu`; falta trazê-la para dentro da aplicação.
  - Modo instalado (`%LOCALAPPDATA%` e Documentos) testado só quanto aos caminhos, não em Windows real.

## Próximas etapas (não iniciadas)

Ordem sugerida, a confirmar: ingestão e análise de vídeos brutos → transcrição →
análise de referências → planejamento → renderização → controle de qualidade →
interface gráfica → instalador para Windows.
