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

## Etapa 10 — Interface, instalador e entrega do software independente ✅ (com ressalva)

Ressalva: tudo foi testado em Linux. O instalador do Windows, os atalhos e a abertura da
janela pelo Edge ainda não foram executados em um Windows real.

- **Interface gráfica** (`src/interface/web/`, servida por `src/interface/servidor.ts`):
  - Painel: criar e abrir projeto, recentes, status do processamento e histórico de atividades.
  - Projetos: nome, objetivo, segmento, plataforma, formato, referências, vídeos brutos,
    histórico e exportações.
  - Material e análise: envio de vídeos, análise em segundo plano, transcrição, cenas com
    miniaturas, pesquisa e relatórios de referências.
  - Plano e roteiro, Edição (timeline visual, prévia, ajustes por item, versões, desfazer,
    comparar), Exportação (presets, destino, conferência, relatórios com exceções, histórico)
    e Avaliação (decisão, notas, trechos, métricas).
  - Aprendizado: o que foi aprendido por contexto, perfis de estilo, preferências, histórico
    e controle da memória.
  - Configurações: modelos locais, provedores externos opcionais, credenciais, modelos
    ativos, recursos que funcionam localmente ou exigem modelo, estado das conexões,
    recursos do computador, pastas e cópias de segurança.
- **Configuração dos projetos:** 9 segmentos (novo: Educação), público, objetivo, plataforma,
  proporção, resolução, FPS, duração, estilo e nível de intervenção automática (sugestão,
  assistido, automático). O plano sempre espera a aprovação.
- **Núcleo:** fluxo de trabalho, tarefas em segundo plano com progresso, histórico de
  atividades, cofre de credenciais e registro de instância. Banco na versão 8.
- **Segurança:** servidor só em 127.0.0.1, origem conferida, sessão por abertura; a chave de
  API nunca volta para a interface nem entra em configurações, registros ou cópias.
- **Instalação e ciclo de vida:** `instalar`, `iniciar`, `parar`, `atualizar`, `backup` e
  `restaurar` em `scripts/`, com atalhos em `windows/` e instalador que usa o winget.
- **Atualização pelo GitHub** preservando dados: cópia antes, migração do banco com cópia
  própria e volta à versão anterior se a nova não abrir.
- **Correções:** abrir a aplicação não interfere mais em renders de outro processo (era a
  causa de uma falha intermitente nos testes); cada render usa uma porta livre própria.
- **Decisão de arquitetura:** janela servida pela própria aplicação em vez de Electron,
  sem dependência nova (registrada em [ARQUITETURA.md](ARQUITETURA.md), seção 10).
- Documentação: [INSTALACAO.md](INSTALACAO.md), [USO.md](USO.md),
  [ATUALIZACAO.md](ATUALIZACAO.md), [BACKUP.md](BACKUP.md) e [LIMITACOES.md](LIMITACOES.md).
- **Testes:** 78 testes de unidade (`npm test`), todos passando — 14 novos: 9 do servidor
  da interface (sessão, projetos, envio, análise com eventos, plano, timeline, prévia com
  reprodução parcial, exportação, avaliação, provedores e chaves, cópias, encerramento) e 5
  do ciclo de vida, com processos próprios (instalar, iniciar, parar, backup, atualizar pelo
  Git, atualização com defeito e restaurar).
- **Auditoria final** (Linux, ambiente sem variáveis nem executável do Claude Code):

  | Item | Como foi testado | Resultado |
  |---|---|---|
  | Instalação limpa | Clone novo do repositório e `instalar.mjs` completo, com dependências reais | Passou (1 min 21 s; 11 de 11 verificações) |
  | Inicialização independente | `iniciar.mjs` na instalação limpa; processo próprio | Passou |
  | Encerramento | Botão Encerrar na janela e `parar.mjs` | Passou |
  | Importação de vídeos | Envio pela janela (Chromium automatizado) | Passou |
  | Análise de referências | Pela janela, com relatório | Passou |
  | Análise de materiais brutos | Pela janela, com transcrição pelo Whisper | Passou |
  | Memória persistente | Reabertura: projeto, aprendizados, provedor e configurações presentes | Passou |
  | Planejamento | Plano gerado ao fim da análise e aprovado pela janela | Passou |
  | Edição | Ajuste de texto, inserção, desfazer e comparação de versões | Passou |
  | Pré-visualização | Prévia gerada e reproduzida na janela | Passou |
  | Renderização e exportação | Exportação com preset, conferida por FFprobe e FFmpeg | Passou |
  | Feedback | Avaliação com notas e preferência registrada | Passou |
  | Atualização | `atualizar.mjs` na instalação limpa, com dados reais, e nos testes | Passou |
  | Backup e restauração | Pela janela, por `backup.mjs` e `restaurar.mjs` | Passou |
  | Sem Claude Code | Ambiente sem as variáveis e sem o executável; `src/` não o menciona | Passou |
  | Instalador do Windows (`Instalar.cmd`, `Instalar.ps1`), winget e atalho | Simulação com PowerShell em Linux e uma execução em Windows 11 real | Passou (2 verificações de ferramentas falharam e foram corrigidas) |
  | Abrir pelo atalho, janela no Edge e uso da aplicação no Windows | — | **Não testado** |
  | Vídeos reais e GPU | — | **Não testado** |

- **Revisão do instalador do Windows** (autorizada depois da entrega): simulação com o
  PowerShell em Linux, guardada em `tests/windows/simular_instalador.sh` (28 verificações).
  A revisão corrigiu quatro defeitos antes de qualquer uso real:
  - a pasta digitada pelo usuário era ignorada quando o instalador sugeria uma;
  - reinstalar trocava as pastas escolhidas antes pelas sugeridas (agora são mantidas);
  - opções extras iam parar no parâmetro errado do instalador;
  - o "python" da Microsoft Store era tomado por Python instalado.
  O atalho passou a ser criado por comando codificado, que preserva espaços, acentos e
  aspas nos caminhos. Novas opções: `-Ramo`, `-Pasta`, `--sugerir-dados`, `--sugerir-biblioteca`.
- **Primeiro teste em Windows real** (feito pelo usuário: Windows 11, Node.js 26.13,
  Python 3.14.7, RTX 3050 6 GB, programa baixado em ZIP):
  - Funcionou: `Instalar.cmd`, instalação do FFmpeg pelo winget, pacotes npm, ambiente
    Python, detecção da placa e do NVENC, render do Remotion com NVENC, yt-dlp, banco e
    atalho. 9 de 11 verificações passaram.
  - Falhou e foi corrigido:
    - Whisper: `cublas64_12.dll` não encontrada. A detecção dava a placa como utilizável só
      pelo driver. Agora as bibliotecas são conferidas de verdade (`Pipeline/transcription/gpu.py`),
      instaladas quando faltam, e a transcrição cai para o processador se a placa falhar.
    - HyperFrames: o navegador próprio dele não abriu ("Invalid file descriptor to ICU
      data"). Agora o cartão tenta o navegador do Remotion e o Chrome ou Edge do sistema;
      se nenhum servir, é desenhado pela composição do Remotion. Os verificadores passaram
      a relatar isso como aviso, porque a aplicação continua funcionando.
    - Aviso `DEP0190` do Node 26 ao chamar arquivos `.cmd`: eliminado.
  - 3 testes novos (`tests/unidade/alternativas.test.ts`), simulando as falhas em Linux;
    a suíte passou a ter 81 testes. As correções ainda não foram conferidas no Windows.
- **Pendências:** estão em [LIMITACOES.md](LIMITACOES.md). As principais:
  - Repetir a instalação no Windows com as correções e testar a abertura e o uso da aplicação.
  - Validar com vídeos reais de FiveM e RedM e calibrar os limites de análise e de qualidade.
  - O instalador baixa o ramo principal do GitHub: o código desta etapa precisa estar nele.
  - Sem instalador único (.exe); prévia não é ao vivo; timeline sem arrastar e soltar.

## Etapa 11 — IA local ✅ (com ressalva)

Pedido do usuário: interpretar localmente o que ficava como "nenhum modelo visual" e
"nenhum modelo de linguagem", sem depender de serviço externo.

Ressalva: o ambiente de desenvolvimento não permite executar o motor baixado. O motor e o
modelo de verdade ainda não rodaram; falta o **Testar** no Windows.

- Decisão: em vez de treinar um modelo próprio (inviável sem dados e processamento em
  grande escala), a aplicação opera um modelo aberto no computador do usuário. Motor
  llama.cpp `llama-server` b12400 (MIT) e modelos Qwen3-VL 4B e 2B (Apache 2.0), com
  versões, tamanhos e SHA-256 fixados em `IA/Local/`. Ollama foi descartado por exigir um
  serviço do sistema; modelos de licença não comercial também.
- `src/servicos/ia-local.ts`:
  - baixa e confere cada arquivo, desempacota o motor e escolhe o modelo pelo computador;
  - liga o motor só quando uma análise precisa e só para `127.0.0.1`;
  - usa a placa de vídeo se couber no `GerenciadorVram`, senão o processador, e liga de
    novo pelo processador se a placa falhar;
  - desliga sozinho sem uso e ao fechar a aplicação.
- A IA local entra como provedor local de texto e de visão, depois dos provedores do
  usuário. As análises de vídeos brutos e de referências e o roteiro passam a usá-la sem
  mudança: o que ela interpreta fica marcado como `estimado`.
- Janela: seção **Configurações → IA local** (instalar com progresso, testar, trocar o
  modelo, desativar, remover). Linha de comando: `ia-local estado | instalar | testar | remover`.
  Instalador: etapa opcional "5 de 6: IA local", com a resposta padrão "sim".
- As mensagens de "não avaliado" passaram a indicar onde instalar a IA local.
- **Testes:** 88 testes de unidade, todos passando — 7 novos (`ia-local.test.ts`), com um
  motor simulado que fala o protocolo do llama-server:
  - recomendação do modelo pelo computador;
  - download conferido e sem repetição; arquivo adulterado descartado;
  - liga sob demanda, reserva e devolve a placa, resposta em JSON, imagens embutidas,
    desligamento sozinho;
  - troca para o processador quando a placa falha ou está ocupada;
  - uso real na análise de um vídeo pela aplicação.
  Os arquivos publicados do motor (Windows, Linux e macOS) e dos modelos foram baixados ou
  consultados para registrar os tamanhos e as somas.
- **Pendências:**
  - Rodar o motor e o Qwen3-VL de verdade no Windows (**Configurações → IA local → Testar**)
    e avaliar a qualidade das interpretações em vídeos reais.
  - O HyperFrames continua sem renderizar no Windows de teste; o erro persistiu com pouca
    memória descartada como causa. A aplicação desenha o cartão pelo Remotion.

### Ajuste — porcentagem em tudo o que leva tempo

Pedido do usuário: a instalação da IA local não mostrava a porcentagem; tudo o que for
feito precisa mostrá-la.

- Janela: toda barra de progresso mostra o número (`barra`/`atualizarBarra`). A aba
  Material e análise ganhou a barra da análise em andamento.
- Tarefas nunca ficam sem porcentagem: começam em 0%, um aviso sem fração mantém a
  anterior e os avisos frequentes são limitados a cinco por segundo.
- A análise avança dentro de cada vídeo (imagem, som, falas, cenas, personagens, humor), e
  não só ao fim de cada arquivo; o mesmo nas referências.
- IA local: o download mostra "1,2 GB de 2,5 GB" e a porcentagem, continua de onde parou
  se a conexão cair, e o teste mostra as etapas.
- Linha de comando e instalador: uma linha que se atualiza com a porcentagem, e o
  cabeçalho de cada etapa do instalador mostra a porcentagem da instalação inteira.
- **Testes:** 89, todos passando, com um teste novo de download interrompido e retomado e a
  conferência de que a análise informa a porcentagem em vários passos. A porcentagem foi
  vista na janela, no navegador, durante uma análise real (0% a 95% em 11 passos).
- **Pendência:** a instalação dos pacotes npm e Python não informa o próprio andamento.

### Ajuste — roteiro cena por cena, IA local maior e janelas do prompt na prévia

Pedidos do usuário: roteiros sem nexo e sem ordem, uma IA local mais inteligente para
organizar o roteiro, e janelas do prompt que continuavam abrindo na prévia.

- **Causa dos roteiros sem nexo:** o modelo recebia só a justificativa técnica de cada
  trecho ("cena de maior ação 0,82"), não o que aparece nele, e as linhas voltavam soltas,
  só agrupadas por bloco.
- **Roteiro reescrito:** cada trecho do plano vira uma cena numerada com tempo, elementos
  vistos, falas transcritas, ritmo e humor do trecho exato
  (`producao.descreverCenas`). O modelo escreve a ideia central e uma linha por cena, na
  ordem; a conferência descarta números e chamadas para ação inventados, repetições e
  abertura genérica, e preenche a cena pulada com a descrição do que mostrar. Sem modelo, a
  estrutura também é por cena, com linguagem legível, e nenhum fato informado fica de fora.
  A tela mostra a ideia central e o tempo de cada cena.
- **IA local:** novo modelo Qwen3-VL 8B (Apache 2.0), recomendado para placa de 6 GB e 16 GB
  de memória. O motor passou a usar a placa o quanto couber (`-ngl auto`) e o processador
  no resto, em vez de "tudo na placa ou nada".
- **Janelas do prompt na prévia:** o Remotion abre o compositor, o FFmpeg e o navegador sem
  pedir janela oculta. No Windows, a aplicação agora inicia com um console invisível
  (`Start-Process -WindowStyle Hidden`), herdado por todos esses programas, e grava o
  próprio registro.
- **IA editora antiga do Cowork:** não foi possível acessá-la daqui (a memória do claude.ai
  e as sessões do Cowork não ficam visíveis para esta sessão; a pasta "Nacional" do
  computador "PH" aparece como indisponível para sessões na nuvem).
- **Testes:** 89, todos passando, com os testes do roteiro reescritos (ordem das cenas,
  cena pulada, número inventado, todos os fatos com uma única cena) e a recomendação do 8B.
  O roteiro foi gerado pela janela, no navegador, sem erros.
- **Pendências:** conferir no Windows que as janelas sumiram; avaliar o roteiro com o 8B em
  vídeos reais; a identidade visual da marca e a referência por link (pedido anterior)
  ainda não começaram.

## Próximas etapas (não iniciadas)

A confirmar com o usuário. Sugestão: validação em Windows real com vídeos reais.
