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

## Etapa 6 — Vídeos brutos e planejamento de edição ✅

- Cinco agentes internos do produto: Arquivos, Conteúdo, Planejamento, Roteiro e
  Coordenador (`app.producao`).
- Arquivos: formato, resolução, taxa de quadros, duração, codecs, áudio, tamanho,
  integridade (íntegro, com erros, ilegível) e problemas técnicos.
- Conteúdo: cenas, momentos de ação, silêncios, transcrição, destaques, possíveis erros de
  gravação e miniaturas; personagens e humor quando há modelo.
- Índice pesquisável por palavras ditas, acontecimentos e características.
- Plano de edição com arquivos e intervalos, estrutura narrativa, transições, áudio,
  legendas, efeitos, trilha e CTA; usa aprendizados e referências e registra a origem de
  cada escolha.
- Aprovação: revisar, aprovar e rejeitar, com histórico de versões e de decisões; a
  renderização fica bloqueada sem plano aprovado; correções viram aprendizado.
- Roteiro apoiado só em fatos, com conferência do texto de modelos.
- Banco na versão 4 (aprovação de planos, decisões, índice).
- Documentação em [PRODUCAO.md](PRODUCAO.md).
- **Testes:** 39 testes de unidade (`npm test`), todos passando — 11 novos, com vídeos em
  1080p MP4, 720×1280 MOV a 60 quadros/s, 360p WebM, MPEG-TS danificado e MP4 truncado.
- **Pendências:**
  - Validação com vídeos reais; os limiares de ação e de relevância são iniciais.
  - Modelos visual e de linguagem testados só com provedores simulados.
  - O planejamento não usa modelo de IA; a escolha dos trechos não entende o conteúdo.
  - Recorte de horizontal para vertical, escolha de trilha e render ficam para a edição.
  - Revisão do plano só por código ou linha de comando; falta a tela.

## Etapa 7 — Motor de edição e renderização ✅

- Um único motor de composição: Remotion, acionado pelo código. FFmpeg prepara os trechos
  (sem alterar os originais) e HyperFrames gera o cartão animado final.
- Timeline editável com 11 operações (inserir, remover, cortar, dividir, ajustar duração,
  reposicionar, mover, mudar camada, alterar, efeito global, formato), não destrutiva,
  com versões e volta atrás.
- Itens: vídeo, imagem, cartão, texto, legenda e áudio (trilha, efeito sonoro, narração);
  velocidade, volume, enquadramento, transição gradual, fade, cor, zoom lento e barras de cinema.
- Agente de Edição: monta a timeline do plano aprovado e só aplica o que o contexto pede,
  registrando a origem de cada escolha.
- Dez estilos de edição combináveis, independentes do perfil.
- Formatos 9:16, 16:9 e 1:1 com resolução e taxa de quadros livres; MP4 H.264 + AAC.
- Prévia em um terço da resolução, render final, fila de tarefas, progresso, cancelamento
  seguro, segunda tentativa conservadora, recuperação na abertura, conferência do arquivo
  e histórico de exportações.
- Banco na versão 5 (timelines e exportações).
- Documentação em [EDICAO.md](EDICAO.md).
- **Testes:** 48 testes de unidade (`npm test`), todos passando — 9 novos, com renders
  reais: prévia vertical, final 1080×1920, horizontal com barras, quadrado, cancelamento
  e falha. O fluxo completo também foi executado pela linha de comando e os quadros do
  vídeo exportado foram conferidos visualmente.
- **Pendências:**
  - Interface gráfica: hoje a timeline é editada por operações e a prévia é um arquivo.
  - Codificação por GPU e execução em Windows não testadas (servidor Linux sem GPU).
  - Poucos efeitos e transições, de propósito; HyperFrames só no cartão final.
  - Sincronia dos cortes com a batida da trilha; legendas em frases curtas.
  - Validação com vídeos reais.

## Etapa 8 — Feedback e aprendizado contínuo ✅

- Avaliação de edições: aprovar, rejeitar, pedir alterações, motivo, notas de 1 a 5 por
  aspecto (roteiro, ritmo, cortes, efeitos, áudio, resultado) e trechos marcados para revisão.
- Comparação de versões da timeline: itens que entraram, saíram e mudaram, e indicadores.
- Correções manuais deduzidas da diferença entre a versão da IA e a aprovada, só quando
  mudam de faixa; valem para o projeto e ficam candidatas no perfil.
- Notas baixas contestam e notas altas confirmam os aprendizados em vigor do aspecto;
  rejeição sem aspecto apontado não ensina nada.
- Planejamento e montagem passam a seguir as preferências aprendidas (transições, cor,
  zoom, barras, legendas, posição dos textos, formato do CTA, volume da trilha).
- Contextos separados: geral, projeto, um por perfil e temporárias; painel do que foi aprendido.
- Rastreabilidade: cada evidência aponta a avaliação ou o resultado de origem.
- Reversibilidade: desfazer avaliação, remover resultado e desfazer qualquer correção,
  desativação, ativação ou exclusão de aprendizado.
- Métricas informadas pelo usuário, com atribuição só com evidência, comparação apenas
  com 3 ou mais resultados do mesmo perfil e plataforma, e sinal fraco que nunca cria regra.
- Duas categorias novas: enquadramento e comunicação. Banco na versão 6.
- Documentação em [FEEDBACK.md](FEEDBACK.md).
- **Testes:** 56 testes de unidade (`npm test`), todos passando — 8 novos, cobrindo
  separação de contextos, rastreabilidade, reversibilidade e métricas.
- **Pendências:**
  - O texto do motivo não é interpretado; só decisões, notas e correções geram aprendizado.
  - "Aprendizados aplicados" são os em vigor no projeto, não a lista exata usada na montagem.
  - Métricas digitadas à mão, sem importação das plataformas.
  - Telas de avaliação, comparação e controle dependem da interface gráfica.

## Etapa 9 — Controle de qualidade e exportação profissional ✅

- Agente de Qualidade (`Pipeline/quality-control/verificador.ts`): 36 verificações em
  quatro grupos — técnicas, visuais, de áudio e do destino —, cada uma com situação,
  gravidade (obrigatória, importante ou recomendação), detalhe e sugestão de correção.
- Conferência independente do renderizador: o arquivo é lido pelo FFprobe e decodificado
  e medido pelo FFmpeg. O que é estimado vem marcado e nunca é obrigatório.
- Seis perfis de qualidade por destino (`IA/Qualidade/`): redes sociais, publicidade,
  YouTube, documentário, institucional e geral. Proporção, duração, áreas seguras,
  abertura, ritmo e CTA só são cobrados onde o destino pede.
- A montagem aplica à timeline as áreas seguras do destino; a operação `apresentacao` as altera.
- Relatório gravado no banco e em arquivo, com situação final: aprovado, aprovado com
  ressalvas, pendente ou reprovado. Falha obrigatória reprova e não pode ser aceita;
  problema importante pode ser aceito pelo usuário, com justificativa registrada.
- Exportação: conferência da timeline antes do render e do arquivo depois; vídeo
  reprovado não entra em `Exportações/`. Sete presets (`IA/Exportacao/`), nome com versão
  e preset, proteção contra sobrescrita, repetição, histórico e cancelamento seguro.
- Perfis e presets do usuário em `Dados/qualidade/` e `Dados/presets/` substituem os padrão.
- Banco na versão 7 (relatórios de qualidade; preset da exportação).
- Correção: a pasta de trabalho de cada render passou a ser única por processo.
- Documentação em [QUALIDADE.md](QUALIDADE.md).
- **Testes:** 64 testes de unidade (`npm test`), todos passando — 8 novos: arquivos com
  um defeito cada (codec, cor, índice, resolução, duração, truncado, tela preta, sem
  áudio, mudo, estourado, áudio curto), verificações da timeline, critérios por destino,
  situação final e exceções, exportação com preset conferida por FFprobe e FFmpeg, vídeo
  reprovado e persistência após reabrir. O fluxo também foi executado pela linha de comando.
- **Pendências:**
  - Verificações visuais usam a timeline e amostras de quadro, sem leitura da imagem (OCR);
    o contraste dos textos ignora a sombra.
  - Sincronia conferida por início e duração das faixas, não pela fala.
  - Limites calibrados com vídeos sintéticos; falta validar com vídeos reais.
  - Telas de relatório, exceções e presets dependem da interface gráfica.
  - Execução em Windows e codificação por GPU continuam sem teste (servidor Linux sem GPU).

## Próximas etapas (não iniciadas)

Ordem sugerida, a confirmar: interface gráfica → instalador para Windows.
