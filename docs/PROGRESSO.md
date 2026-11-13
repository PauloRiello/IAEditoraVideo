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
  - Interface gráfica, instalador e atualização automática.
  - Provedor de transcrição local (ligação do Whisper à aplicação).
  - Detecção de GPU ainda depende de `npm run gpu`; falta trazê-la para dentro da aplicação.
  - Modo instalado (`%LOCALAPPDATA%` e Documentos) testado só quanto aos caminhos, não em Windows real.

## Etapa 4 — Memória persistente e aprendizado ✅

- Banco na versão 2: referências, análises, planos de edição versionados, aprendizados
  com evidências e registro de modelos e provedores usados.
- Aprendizado controlado: 18 categorias de edição, quatro escopos (geral, especialização,
  projeto, temporária), confiança por evidências, promoção só após repetição em projetos
  distintos, e revisão (corrigir, desativar, ativar, excluir).
- Perfis novos: redes-sociais, publicidade, institucional, documentario, youtube.
  Combinação de perfis sem mistura automática do que é incompatível.
- Proteção de dados: gravação imediata, cópia manual e automática com rotação,
  restauração reversível, cópia antes de migrar e recuperação de banco corrompido.
- Exemplo executável (`npm run exemplo:memoria`) e [MEMORIA.md](MEMORIA.md).
- **Testes:** 21 testes de unidade (`npm test`), todos passando — 11 novos nesta etapa.
- **Pendências:**
  - Nenhuma etapa aplica os aprendizados ainda (não há motor de edição).
  - Extração automática de aprendizados a partir de feedback em texto e de análises.
  - Cópia de segurança não inclui mídias nem perfis do usuário.
  - Telas de revisão de aprendizados e de restauração (dependem da interface gráfica).

## Etapa 5 — Análise de referências ✅

- Analisador em `Pipeline/analysis/`: medição de imagem (cortes, planos, ritmo,
  transições, movimento de câmera, zoom, cor, luz, barras de cinema) e de áudio (volume,
  silêncios, mudanças de intensidade, batidas, pontos de corte musical, sincronia com os
  cortes), por amostragem em baixa resolução com uma única decodificação.
- Transcrição pelo Whisper local (`Pipeline/transcription/`), com escolha de GPU ou CPU pela VRAM livre.
- Narrativa por medição e, quando há provedor, por modelo; estrutura de redes sociais só
  onde o perfil a espera. Tipos de conteúdo de FiveM e RedM definidos nos perfis.
- Cada item marcado como observado, estimado, não avaliado ou não se aplica.
- Saídas: relatório JSON e Markdown, perfil de estilo, regras com exemplo de aplicação e
  confiança; tudo gravado na memória. Uma referência só gera aprendizados candidatos.
- Banco na versão 3 (evidências ligadas a referências); provedores passam a aceitar imagens.
- Importação pela pasta `Referências/` e comandos `referencias importar | listar | analisar`.
- Documentação em [REFERENCIAS.md](REFERENCIAS.md).
- **Testes:** 28 testes de unidade (`npm test`), todos passando — 7 novos, com vídeos de
  exemplo gerados pelo FFmpeg e transcrição real pelo Whisper.
- **Pendências:**
  - Validação com vídeos reais (os testes usam vídeos sintéticos de resposta conhecida).
  - Leitura por modelo visual e de linguagem testada só com provedores simulados.
  - Importação de referências pela interface gráfica e download autorizado pelo yt-dlp.
  - Efeitos sonoros e distinção entre diálogo e narração não são avaliados.
  - Movimento de câmera é estimativa simples; ver limites em REFERENCIAS.md.

## Próximas etapas (não iniciadas)

Ordem sugerida, a confirmar: ingestão e análise de vídeos brutos (reaproveitando o
analisador) → planejamento → renderização → controle de qualidade → interface gráfica →
instalador para Windows.
