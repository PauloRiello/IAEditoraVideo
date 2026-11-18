# Arquitetura — IA Editora de Vídeo

> Status: **primeira versão utilizável.** Núcleo, processamento audiovisual, interface
> gráfica, instalação, atualização e cópias de segurança implementados e testados em
> Linux; o instalador do Windows ainda não foi executado em um Windows real. O andamento
> está em [PROGRESSO.md](PROGRESSO.md) e as pendências em [LIMITACOES.md](LIMITACOES.md).

## 1. Visão geral

Aplicação de edição inteligente de vídeo que roda no computador do usuário (Windows
10/11 como alvo principal). Analisa referências e vídeos brutos, planeja a edição,
renderiza, verifica a qualidade e aprende com o feedback, guardando memória própria.

O primeiro foco comercial são vídeos promocionais de servidores FiveM e RedM para
Instagram e TikTok. Isso é um **perfil de especialização** (um arquivo de dados), não
uma característica do código: o mesmo núcleo atende marketing, institucional, YouTube,
documentário, educacional, trailer e conteúdo pessoal.

## 2. Princípios

1. **Independente.** O produto não usa Claude Code, Claude Desktop, sessões de agentes
   nem histórico de conversa. Nenhuma API de IA é obrigatória. Um teste automatizado
   falha se o código em `src/` mencionar Claude ou Anthropic.
2. **Local primeiro.** O processamento acontece no computador do usuário. Provedores
   externos são opcionais e vêm desligados.
3. **Camadas separadas.** Interface, lógica de negócio, serviços, banco de dados e
   processamento audiovisual não se misturam (seção 3).
4. **Dados persistentes.** Projetos, configurações, memória e aprendizado ficam em disco,
   fora da pasta do programa, e sobrevivem a fechamentos e atualizações.
5. **Originais são somente leitura.** Mídias do usuário são registradas pelo caminho;
   nunca são copiadas, movidas ou alteradas sem pedido.
6. **Especialização por configuração.** Nichos novos entram como perfis em JSON.

## 3. Camadas

```
┌────────────────────────────────────────────────────────────┐
│ Interface            src/interface/                        │
│ janela (servidor local + página) · linha de comando        │
└───────────────┬────────────────────────────────────────────┘
                │ só conhece a classe Aplicacao
┌───────────────▼────────────────────────────────────────────┐
│ Núcleo               src/nucleo/                           │
│ Aplicacao (ciclo de vida) · Orquestrador (pipeline)        │
└───────┬───────────────────────────────┬────────────────────┘
        │                               │ contrato EtapaPipeline
┌───────▼──────────────────┐   ┌────────▼───────────────────┐
│ Serviços  src/servicos/  │   │ Processamento audiovisual  │
│ projetos · memória ·     │   │ Pipeline/<etapa>/          │
│ aprendizado · perfis ·   │   │ FFmpeg · Whisper ·         │
│ provedores de IA ·       │   │ Remotion · HyperFrames ·   │
│ recursos (CPU/GPU/VRAM)  │   │ yt-dlp                     │
└───────┬──────────────────┘   └────────────────────────────┘
┌───────▼────────────────────────────────────────────────────┐
│ Infraestrutura       src/infra/                            │
│ banco SQLite · caminhos · configurações                    │
└────────────────────────────────────────────────────────────┘
        Domínio  src/dominio/  — tipos e contratos, sem E/S; usado por todas as camadas
```

Regras de dependência: cada camada só importa as de baixo. O domínio não importa
ninguém. Só `src/infra/banco.ts` conhece o esquema das tabelas. Só a camada de
processamento executa ferramentas audiovisuais.

## 4. Módulos e responsabilidades

| Módulo | Onde | Responsabilidade | Situação |
|---|---|---|---|
| Núcleo de orquestração | `src/nucleo/` | Montar serviços, iniciar e encerrar, executar o pipeline por etapas e gravar cada resultado | Implementado |
| Interface gráfica | `src/interface/servidor.ts`, `rotas.ts`, `principal.ts`, `web/` | Servidor local (só 127.0.0.1, com sessão), rotas que traduzem pedidos em chamadas à `Aplicacao`, e a página da janela, sem lógica de negócio | Implementado |
| Linha de comando | `src/interface/cli.ts` | Os mesmos recursos em comandos, para automação e para os scripts de instalação | Implementado |
| Fluxo de trabalho | `src/nucleo/fluxo.ts` | Ações que a janela aciona: configuração do projeto, nível de intervenção automática, tarefas e histórico de atividades | Implementado |
| Tarefas em segundo plano | `src/nucleo/tarefas.ts` | Fila de análises com estado e progresso; espelha os renders para o painel | Implementado |
| Histórico de atividades | `src/servicos/atividades.ts` | Registro do que aconteceu na aplicação e em cada projeto | Implementado |
| Credenciais | `src/infra/credenciais.ts` | Chaves de API em arquivo próprio na pasta de dados, fora das configurações, dos registros e das cópias | Implementado |
| Instância em execução | `src/infra/instancia.ts` | Registro do processo aberto: uma instância por pasta de dados; comandos paralelos não mexem no trabalho em andamento | Implementado |
| Instalação e ciclo de vida | `scripts/{instalar,iniciar,parar,atualizar,backup,restaurar}.mjs`, `windows/` | Instalar, abrir, fechar, atualizar pelo Git e copiar ou restaurar dados | Implementado; `windows/` não testado em Windows real |
| Projetos | `src/servicos/projetos.ts` | Criar, listar, configurar e remover projetos; registrar mídias | Implementado |
| Análise de referências | `Pipeline/analysis/`, `src/nucleo/referencias.ts` | Medir imagem e áudio, interpretar narrativa, gerar regras de edição, relatórios e aprendizados | Implementado |
| Transcrição | `Pipeline/transcription/` | Fala → texto pelo Whisper local, como processo separado | Implementado para referências; etapa do pipeline pendente |
| Análise de vídeos brutos | `Pipeline/ingestion/arquivos.ts`, `Pipeline/analysis/conteudo.ts` | Agentes de Arquivos e de Conteúdo: dados técnicos, integridade, cenas, ação, falas, erros, miniaturas e índice | Implementado |
| Pesquisa nos brutos | `src/servicos/indice.ts` | Índice por trecho, pesquisável por palavras, acontecimentos e características | Implementado |
| Planejamento de edição | `Pipeline/editing/planejamento.ts` | Agente de Planejamento: plano com arquivos, intervalos, estrutura, áudio, legendas, trilha e CTA | Implementado |
| Roteiro | `Pipeline/editing/roteiro.ts` | Agente de Roteiro: texto apoiado só em fatos do material | Implementado |
| Coordenação e aprovação | `src/nucleo/producao.ts` | Agente Coordenador: aciona os agentes, guarda na memória e exige aprovação do plano antes da edição | Implementado |
| Montagem da timeline | `Pipeline/editing/montagem.ts` | Agente de Edição: do plano aprovado à timeline, escolhendo recursos pelo contexto | Implementado |
| Timeline editável | `src/servicos/timeline.ts`, `src/dominio/timeline.ts` | Operações não destrutivas, versões e histórico de exportações | Implementado |
| Estilos de edição | `src/servicos/estilos.ts`, `IA/Estilos/` | Carregar e combinar estilos (gameplay, ação, trailer...) | Implementado (10 estilos) |
| Renderização | `Pipeline/rendering/` | Remotion compõe; FFmpeg prepara trechos; HyperFrames gera cartões | Implementado |
| Tarefas de render e exportação | `src/nucleo/edicao.ts` | Fila, progresso, cancelamento, nova tentativa, presets, nomes com versão, proteção contra sobrescrita e histórico | Implementado |
| Feedback e aprendizado contínuo | `src/nucleo/feedback.ts`, `src/servicos/comparacao.ts` | Avaliar edições, comparar versões, deduzir correções manuais, registrar métricas e mostrar o que foi aprendido | Implementado |
| Memória persistente | `src/servicos/memoria.ts`, `acervo.ts` | Preferências, referências, análises, planos versionados e uso de IA | Implementado |
| Aprendizado | `src/servicos/aprendizado.ts` | Feedback e aprendizados com evidências, confiança, escopo e revisão | Implementado; extração automática pendente |
| Controle de qualidade | `Pipeline/quality-control/verificador.ts`, `src/nucleo/qualidade.ts` | Agente de Qualidade: verificações técnicas, visuais, de áudio e do destino, com FFmpeg e FFprobe; relatórios, situação final e exceções aceitas | Implementado |
| Perfis de qualidade e presets | `src/servicos/qualidade.ts`, `IA/Qualidade/`, `IA/Exportacao/` | Critérios por destino e presets de exportação, com substituição pelos arquivos do usuário | Implementado (6 destinos, 7 presets) |
| IA local | `src/servicos/ia-local.ts`, `IA/Local/` | Baixar e conferir o motor (llama.cpp) e o modelo (Qwen3-VL), ligar sob demanda na placa de vídeo ou no processador, desligar sem uso; entra como provedor local de texto e visão | Implementado; motor real não executado no ambiente de desenvolvimento |
| Provedores de IA | `src/servicos/provedores.ts` | Registrar provedores, aplicar a política local/externo e selecionar por capacidade; texto e leitura de imagens | Implementado |
| Recursos do computador | `src/servicos/recursos.ts` | Ler CPU, RAM e GPU; decidir GPU ou CPU por modelo conforme a VRAM | Implementado |
| Perfis de especialização | `src/servicos/perfis.ts`, `IA/Perfis/` | Carregar e combinar perfis e formatos de saída | Implementado (9 perfis) |
| Cópias de segurança | `src/infra/backup.ts` | Criar, validar, restaurar e rotacionar cópias; isolar arquivos corrompidos | Implementado |
| Arquivos e exportações | `src/infra/caminhos.ts` | Definir e criar a estrutura de pastas | Implementado |
| Banco de dados | `src/infra/banco.ts` | Esquema, migrações, transações e verificação de integridade | Implementado (esquema v8) |
| Configurações | `src/infra/configuracoes.ts` | Ler e gravar preferências do usuário | Implementado |

## 5. Pipeline

O `Orquestrador` executa as etapas registradas nesta ordem. Cada etapa implementa
`EtapaPipeline` (`src/dominio/pipeline.ts`), recebe os resultados das anteriores e
devolve o seu em JSON, gravado na tabela `execucoes`.

| Etapa | Entrada → saída |
|---|---|
| `ingestion` | Arquivos → registro de mídia com metadados |
| `analysis` | Mídias → cenas, silêncios, qualidade, estilo das referências |
| `transcription` | Áudio → texto com tempo por palavra |
| `editing` | Análises + perfil + memória → `PlanoDeEdicao` |
| `rendering` | `PlanoDeEdicao` → vídeo em `Exportações/` |
| `quality-control` | Vídeo → aprovação ou lista de problemas |

- **Aprovação:** a etapa `rendering` só roda se a versão atual do plano estiver aprovada.
- **Reexecução parcial:** é possível refazer um intervalo de etapas (por exemplo, só
  `editing`); as anteriores não rodam de novo, seus resultados vêm do banco.
- **Falha:** o pipeline para na primeira etapa que falhar e registra o erro.
- **Eventos:** `etapa:iniciada`, `etapa:concluida` e `etapa:falhou`, para a interface
  mostrar o andamento.

## 6. Provedores de IA

A aplicação conhece apenas o contrato `ProvedorIA`: um identificador, a origem
(`local` ou `externo`), as capacidades (`texto`, `visao`, `transcricao`, `embeddings`)
e um teste de disponibilidade.

- **Sem provedor, a aplicação abre normalmente.** Só a operação que precisa de uma
  capacidade ausente falha, com o erro `CapacidadeIndisponivel`.
- **Política** (em `configuracoes.json`): `preferirLocal` põe provedores locais na
  frente; `permitirExternos` vem desligado, e enquanto estiver assim nenhum dado sai
  do computador.
- **Chaves de API** nunca são gravadas em arquivo: a configuração guarda só o nome da
  variável de ambiente que contém a chave.
- **Adaptador incluído:** protocolo HTTP compatível com OpenAI, que cobre servidores
  locais (Ollama, LM Studio, llama.cpp) e diversas APIs externas. Outros protocolos
  entram como novas classes que implementam `ProvedorIA`.

O contrato tem duas operações opcionais: `gerarTexto` e `descreverImagens`. O Whisper não
passa por essa camada: roda localmente, como processo Python, em `Pipeline/transcription/`.

A edição e a renderização — timeline, estilos, prévia, exportação e papel de cada
ferramenta — estão em [EDICAO.md](EDICAO.md). A avaliação das edições, as métricas de
resultado e o controle do que foi aprendido estão em [FEEDBACK.md](FEEDBACK.md).

A preparação do vídeo — brutos, pesquisa, plano, aprovação e roteiro — é feita por cinco
agentes internos, descritos em [PRODUCAO.md](PRODUCAO.md). "Agente" aqui é um componente
da aplicação com uma única responsabilidade, não um serviço externo.

A análise de referências, descrita em [REFERENCIAS.md](REFERENCIAS.md), foi o primeiro
módulo a usar os provedores: funciona sem eles e marca cada resultado como observado,
estimado ou não avaliado.

## 7. Processamento local e GPU

- `detectarHardware` lê núcleos, RAM e a GPU detectada por `npm run gpu`.
- `GerenciadorVram` decide, modelo a modelo, entre GPU e CPU: um modelo só vai para a
  GPU se couber na VRAM livre junto com os que já estão carregados, respeitada uma
  margem para o sistema (1024 MB por padrão). Sem GPU NVIDIA, tudo roda em CPU.
- Codificação de vídeo por hardware (NVENC e similares) é decidida à parte, pelo teste
  real de encoders descrito em [AMBIENTE.md](AMBIENTE.md).
- Processamento em nuvem, se vier, entra como um provedor externo ou um `MotorRender`
  adicional, sem alterar o núcleo.

## 8. Dados e arquivos

| Conteúdo | Em desenvolvimento | Instalado no Windows | No Git? |
|---|---|---|---|
| Código-fonte | `src/`, `Pipeline/` | Pasta do programa | Sim |
| Perfis padrão | `IA/Perfis/` | Pasta do programa | Sim |
| Banco de dados | `Dados/banco/editora.db` | `%LOCALAPPDATA%\IAEditoraVideo\banco\` | Não |
| Configurações do usuário | `Dados/config/` | `%LOCALAPPDATA%\IAEditoraVideo\config\` | Não |
| Projetos | `Dados/projetos/` | `%LOCALAPPDATA%\IAEditoraVideo\projetos\` | Não |
| Temporários | `Dados/temp/` | `%LOCALAPPDATA%\IAEditoraVideo\temp\` | Não |
| Backups | `Dados/backups/` | `%LOCALAPPDATA%\IAEditoraVideo\backups\` | Não |
| Modelos de IA | `Dados/modelos/` | `%LOCALAPPDATA%\IAEditoraVideo\modelos\` | Não |
| Relatórios de análise | `Dados/analises/` | `%LOCALAPPDATA%\IAEditoraVideo\analises\` | Não |
| Trechos preparados, prévias e miniaturas | `Dados/projetos/<projeto>/` | `%LOCALAPPDATA%\IAEditoraVideo\projetos\` | Não |
| Estilos do usuário | `Dados/estilos/` | `%LOCALAPPDATA%\IAEditoraVideo\estilos\` | Não |
| Perfis de qualidade e presets padrão | `IA/Qualidade/`, `IA/Exportacao/` | Pasta do programa | Sim |
| Perfis de qualidade e presets do usuário | `Dados/qualidade/`, `Dados/presets/` | `%LOCALAPPDATA%\IAEditoraVideo\qualidade\` e `presets\` | Não |
| Vídeos em conferência e reprovados | `Dados/projetos/<projeto>/em-conferencia/`, `reprovados/` | `%LOCALAPPDATA%\IAEditoraVideo\projetos\` | Não |
| Mídias originais | `Videos Brutos/`, `Referências/` | `Documentos\IA Editora de Vídeo\` | Não |
| Chaves de API | `Dados/config/credenciais.json` | `%LOCALAPPDATA%\IAEditoraVideo\config\` | Não |
| Registro da aplicação e instância aberta | `Dados/logs/aplicacao.log`, `Dados/execucao.json` | `%LOCALAPPDATA%\IAEditoraVideo\` | Não |
| Pastas escolhidas na instalação | `config/local.instalacao.json` | Pasta do programa | Não |
| Exportações e relatórios de qualidade | `Exportações/<projeto>/` e `relatorios/` | `Documentos\IA Editora de Vídeo\Exportações\` | Não |

A pasta de dados e a de mídias são definidas, nesta ordem, pelas variáveis `IAEV_DADOS` e
`IAEV_BIBLIOTECA`, pelo arquivo `config/local.instalacao.json` gravado pelo instalador, ou
pelo padrão de desenvolvimento (dentro do repositório, fora do Git). As demais pastas de `IA/` (Memoria, Aprendizado, Feedback, Analises,
Conhecimento) ficam reservadas para conteúdo versionável dessas áreas; os dados de
cada usuário vão para o banco.

**Banco (SQLite, esquema v8):** `projetos`, `midias`, `execucoes`, `memoria`, `feedback`,
`referencias`, `projeto_referencias`, `analises`, `planos`, `aprendizados`, `evidencias`,
`usos_ia`, `decisoes`, `indice`, `timelines`, `exportacoes`, `avaliacoes`,
`trechos_em_revisao`, `resultados`, `acoes_de_aprendizado`, `relatorios_de_qualidade`, `atividades`. O banco guarda caminhos, metadados e resultados, nunca vídeos.

- **Atualizações:** o esquema evolui por migrações numeradas; uma versão nova do
  programa aplica só as que faltam, depois de criar uma cópia do banco. Configurações
  antigas recebem valores padrão nas chaves ausentes.
- **Proteção:** gravação imediata em disco, cópias manuais e automáticas, restauração
  reversível e recuperação de banco corrompido.

O funcionamento da memória, do aprendizado e das proteções está em [MEMORIA.md](MEMORIA.md);
o controle de qualidade e a exportação, em [QUALIDADE.md](QUALIDADE.md).

## 9. Tecnologias

| Função | Tecnologia | Justificativa |
|---|---|---|
| Linguagem do núcleo | TypeScript sobre Node.js 22 | Remotion e HyperFrames são bibliotecas Node; um só ambiente para núcleo, render e interface |
| Banco | SQLite nativo do Node (`node:sqlite`) | Sem módulo compilado para instalar ou empacotar no Windows |
| Composição e render | Remotion, único motor de composição | Acionado pelo código (`@remotion/renderer` e `@remotion/bundler`), para ter progresso e cancelamento |
| Cartões animados | HyperFrames | HTML/CSS/GSAP renderizado como trecho de vídeo que entra na timeline |
| Mídia | FFmpeg e FFprobe | Já instalados e verificados |
| Transcrição | faster-whisper (Python) | Já instalado; a etapa o chama como processo separado |
| Referências | yt-dlp (Python) | Já instalado; uso restrito a conteúdo autorizado |
| Interface gráfica | Servidor HTTP nativo do Node e página em HTML, CSS e JavaScript puros | Nenhuma dependência nova, nada a compilar; abre em janela própria do Edge ou do Chrome |
| Testes | Executor nativo do Node (`node --test`) | Sem dependência adicional |

Dependências de produção acrescentadas ao longo do projeto: apenas `@remotion/renderer` e
`@remotion/bundler`, na etapa de renderização. Elas já vinham instaladas com o
`@remotion/cli` e foram declaradas para poder acionar o render pelo código, o que dá
progresso, cancelamento e controle de paralelismo. A interface gráfica, o instalador e os
scripts de ciclo de vida não acrescentaram nenhuma dependência.

## 10. Aplicação instalável: interface, instalação e ciclo de vida

| Item | Como funciona |
|---|---|
| Aplicativo (.exe) | `aplicativo/principal.mjs` (Electron) é o programa instalado: tela de abertura com porcentagem, preparação do computador (`src/interface/preparar.ts`), servidor iniciado como processo filho rodando o próprio executável como Node (`ELECTRON_RUN_AS_NODE`) com `windowsHide`, e janela própria. O console invisível do servidor é herdado por Remotion, FFmpeg e Python: nenhuma janela de prompt |
| Janela | `src/interface/principal.ts` abre a `Aplicacao` e um servidor HTTP em `127.0.0.1`. No aplicativo, a página aparece numa janela do Electron; pelo código-fonte, numa janela do Edge ou do Chrome (`--app`) |
| Modo anfitrião | Com `IAEV_ANFITRIAO=1`, `principal.ts` fala por linhas JSON (etapa e fração, pronta com porta e sessão, ou erro) e encerra quando a entrada padrão fecha |
| Ambiente da máquina | `Caminhos.ambiente` (`<dados>/ambiente`): Python portátil e ambiente virtual, FFmpeg, `aceleracao.json`. Fora da pasta do programa porque a atualização a substitui. Instalações antigas (`.venv` e `config/local.aceleracao.json` na pasta do programa) continuam valendo |
| Segurança da janela | Só o próprio computador é atendido; o endereço de origem é conferido; cada abertura sorteia um segredo de sessão, entregue por cookie que o JavaScript não lê; arquivos são servidos só por identificador, nunca por caminho livre |
| Eventos | Tarefas, renders e atividades chegam à janela por eventos enviados pelo servidor (`/api/eventos`) |
| Instância única | `Dados/execucao.json` registra processo, porta e sessão. Abrir de novo só reabre a janela |
| Encerramento | Botão Encerrar, `parar.mjs` ou fechar a janela (a aplicação termina o trabalho e se encerra sem janela). Renders são interrompidos sem deixar arquivo pela metade |
| Instalação | Aplicativo: `Setup.exe` (NSIS, por usuário, sem administrador; `electron-builder.yml`). Pelo código-fonte: `windows/Instalar.cmd` instala Node.js, Git, FFmpeg e Python pelo winget e chama `scripts/instalar.mjs` |
| Atualização | Aplicativo: `aplicativo/atualizacao.mjs` (electron-updater) procura os lançamentos do GitHub ao abrir e a cada 6 h, baixa com porcentagem e instala ao fechar, depois da cópia "pre-atualizacao" e nunca com tarefa em andamento. Pelo código-fonte: `scripts/atualizar.mjs` com Git |
| Lançamento | `.github/workflows/lancamento.yml`: num Windows, gera o instalador, instala em silêncio, abre com `--teste-de-fumaca` e, nas etiquetas `v*`, publica ([LANCAMENTO.md](LANCAMENTO.md)) |
| Cópias de segurança | Automáticas, manuais, antes de migração, de atualização e de restauração; pela janela ou por `backup.mjs` e `restaurar.mjs` |

**Decisões registradas.** Primeiro foi adotada a janela servida pela própria aplicação,
aberta no Edge ou no Chrome, sem dependência nova. Em 18/11/2026 o usuário pediu um .exe
sem janelas de prompt, com tela de abertura e atualização automática: a mesma página passou
a ser embutida num Electron, que só embrulha (não tem regra de negócio, e o servidor
continua só com módulos nativos do Node). O código fica fora de pacote compactado (`asar:
false`) porque o servidor lê os `.ts` direto e o Remotion executa binários de
`node_modules`. O instalador é gerado num Windows, porque os binários nativos (compositor
do Remotion) são escolhidos pelo sistema onde as dependências são instaladas. Guias:
[INSTALACAO.md](INSTALACAO.md), [USO.md](USO.md), [ATUALIZACAO.md](ATUALIZACAO.md) e
[BACKUP.md](BACKUP.md).

## 11. Dependências

**Existentes e verificadas:** Node.js, TypeScript, Remotion, HyperFrames, GSAP, React,
FFmpeg, FFprobe, faster-whisper, yt-dlp, SQLite (nativo). Versões em [VERSOES.md](VERSOES.md).

**Do aplicativo Windows** (dependências novas, versões fixas):

| Dependência | Versão | Licença | Por que esta |
|---|---|---|---|
| Electron | 45.2.2 (desenvolvimento; vai dentro do instalador) | MIT | Janela própria e instalador único; o próprio executável roda o servidor como Node 24 (com `node:sqlite` e TypeScript direto, conferido), então o usuário não precisa instalar Node.js. Alternativas: Tauri e WebView2 exigiriam um Node separado para o servidor |
| electron-builder | 26.18.0 (desenvolvimento) | MIT | Gera o instalador NSIS por usuário e os arquivos (`latest.yml`, `.blockmap`) que a atualização usa |
| electron-updater | 6.8.11 (produção) | MIT | Atualização pelos lançamentos do GitHub, com download em segundo plano e porcentagem |
| FFmpeg portátil | 8.0.1, build essentials de Gyan Doshi (espelho GitHub) | GPL-3.0 | Baixado pela preparação só se não houver FFmpeg; mesmo build que o winget instala. Fixado em `IA/Ambiente/` |
| Python portátil | 3.12.12, python-build-standalone 20251217 | PSF-2.0 | Baixado pela preparação só se não houver Python 3.11+; a soma confere com a publicada. Fixado em `IA/Ambiente/` |

**Exigidas no computador do usuário, pelo código-fonte** (instaladas pelo `Instalar.cmd` quando faltam; o aplicativo não exige nenhuma):
Node.js 22.20 ou mais recente, Python 3.11 ou mais recente, FFmpeg com FFprobe e Git. Para
abrir a janela: Microsoft Edge, Chrome ou outro navegador atual. As bibliotecas do
programa (pacotes npm e Python) são instaladas por `npm run setup`, acionado pelo instalador.

**IA local (baixada pela aplicação, a pedido do usuário):**

| Componente | Versão | Licença | Por que este |
|---|---|---|---|
| Motor llama.cpp (`llama-server`) | b12400, fixada | MIT | Programa único, sem instalação, com API compatível com a da OpenAI (a camada de provedores já fala essa língua), entende imagens e roda por Vulkan (NVIDIA, AMD ou Intel), Metal ou processador. Fica na pasta de dados; não é dependência npm |
| Modelo Qwen3-VL 4B Instruct (Q4_K_M) | revisão fixada | Apache 2.0 | Visão e linguagem num só modelo, bom em português, cabe em 4 GB de placa de vídeo; licença permite uso comercial |
| Modelo Qwen3-VL 2B Instruct (Q8_0) | revisão fixada | Apache 2.0 | Alternativa para computadores mais fracos |

Cada arquivo tem tamanho e SHA-256 registrados em `IA/Local/`; um arquivo que não confere é
descartado. Foram descartados: Ollama (exige instalar e manter um serviço do sistema),
modelos com licença não comercial e treinar um modelo próprio (exige dados e
processamento que não existem no projeto).

**Opcionais ou futuras (não instaladas):**

| Dependência | Para quê |
|---|---|
| Assinatura digital do instalador | Tirar o aviso "O Windows protegeu o computador" (exige certificado pago) |
| Outro servidor de modelo local (Ollama, LM Studio) | Opcional, para quem já usa um; detectado em Configurações. A IA local já cobre o caso comum |

## 12. Decisões em aberto

- Quando usar Remotion ou HyperFrames em cada tipo de vídeo.
- Modelo do Whisper padrão para produção e por faixa de hardware.
- Modelos locais de linguagem e visão recomendados por faixa de VRAM.
- Estratégia de planejamento quando não há nenhum provedor de texto (regras fixas por perfil).
