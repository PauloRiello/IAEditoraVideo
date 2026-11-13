# Arquitetura — IA Editora de Vídeo

> Status: **estrutura central implementada e testada.** As etapas de processamento
> audiovisual e a interface gráfica ainda não existem. O andamento está em
> [PROGRESSO.md](PROGRESSO.md).

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
│ linha de comando (hoje) · janela gráfica (futura)          │
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
| Interface | `src/interface/` | Apresentar a aplicação ao usuário, sem lógica de negócio | Linha de comando implementada; janela gráfica pendente |
| Projetos | `src/servicos/projetos.ts` | Criar, listar, abrir e remover projetos; registrar mídias | Implementado |
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
| Tarefas de render | `src/nucleo/edicao.ts` | Fila, progresso, cancelamento, nova tentativa, conferência do arquivo e histórico | Implementado |
| Memória persistente | `src/servicos/memoria.ts`, `acervo.ts` | Preferências, referências, análises, planos versionados e uso de IA | Implementado |
| Aprendizado | `src/servicos/aprendizado.ts` | Feedback e aprendizados com evidências, confiança, escopo e revisão | Implementado; extração automática pendente |
| Controle de qualidade | `Pipeline/quality-control/` | Conferir duração, sincronia, áudio e conformidade com o formato | Contrato definido |
| Provedores de IA | `src/servicos/provedores.ts` | Registrar provedores, aplicar a política local/externo e selecionar por capacidade; texto e leitura de imagens | Implementado |
| Recursos do computador | `src/servicos/recursos.ts` | Ler CPU, RAM e GPU; decidir GPU ou CPU por modelo conforme a VRAM | Implementado |
| Perfis de especialização | `src/servicos/perfis.ts`, `IA/Perfis/` | Carregar e combinar perfis e formatos de saída | Implementado (8 perfis) |
| Cópias de segurança | `src/infra/backup.ts` | Criar, validar, restaurar e rotacionar cópias; isolar arquivos corrompidos | Implementado |
| Arquivos e exportações | `src/infra/caminhos.ts` | Definir e criar a estrutura de pastas | Estrutura implementada; nomeação de exportações pendente |
| Banco de dados | `src/infra/banco.ts` | Esquema, migrações, transações e verificação de integridade | Implementado (esquema v5) |
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
ferramenta — estão em [EDICAO.md](EDICAO.md).

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
| Mídias originais | `Videos Brutos/`, `Referências/` | `Documentos\IA Editora de Vídeo\` | Não |
| Exportações | `Exportações/` | `Documentos\IA Editora de Vídeo\Exportações\` | Não |

As variáveis `IAEV_DADOS` e `IAEV_BIBLIOTECA` redirecionam as pastas de dados e de
mídias. As demais pastas de `IA/` (Memoria, Aprendizado, Feedback, Analises,
Conhecimento) ficam reservadas para conteúdo versionável dessas áreas; os dados de
cada usuário vão para o banco.

**Banco (SQLite, esquema v5):** `projetos`, `midias`, `execucoes`, `memoria`, `feedback`,
`referencias`, `projeto_referencias`, `analises`, `planos`, `aprendizados`, `evidencias`,
`usos_ia`, `decisoes`, `indice`, `timelines`, `exportacoes`. O banco guarda caminhos, metadados e resultados, nunca vídeos.

- **Atualizações:** o esquema evolui por migrações numeradas; uma versão nova do
  programa aplica só as que faltam, depois de criar uma cópia do banco. Configurações
  antigas recebem valores padrão nas chaves ausentes.
- **Proteção:** gravação imediata em disco, cópias manuais e automáticas, restauração
  reversível e recuperação de banco corrompido.

O funcionamento da memória, do aprendizado e das proteções está em [MEMORIA.md](MEMORIA.md).

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
| Testes | Executor nativo do Node (`node --test`) | Sem dependência adicional |

Dependências de produção acrescentadas ao longo do projeto: apenas `@remotion/renderer` e
`@remotion/bundler`, na etapa de renderização. Elas já vinham instaladas com o
`@remotion/cli` e foram declaradas para poder acionar o render pelo código, o que dá
progresso, cancelamento e controle de paralelismo.

## 10. Caminho para a aplicação instalável no Windows

Planejado, ainda não implementado:

| Item | Abordagem |
|---|---|
| Janela gráfica | Electron com React: embute o Node (necessário ao Remotion) e reaproveita os componentes de vídeo na prévia. A janela fala com a `Aplicacao` por um canal interno |
| Instalador | electron-builder (NSIS), com Node, FFmpeg e um Python embutido para Whisper e yt-dlp |
| Inicialização e encerramento | `new Aplicacao()` e `encerrar()`, já implementados |
| Atualização | Atualizador do Electron; os dados ficam fora da pasta do programa e o banco migra sozinho |
| Backup | Cópia manual, cópia automática ao abrir e restauração já implementadas; falta a tela |

## 11. Dependências

**Existentes e verificadas:** Node.js, TypeScript, Remotion, HyperFrames, GSAP, React,
FFmpeg, FFprobe, faster-whisper, yt-dlp, SQLite (nativo). Versões em [VERSOES.md](VERSOES.md).

**Pendentes (não instaladas):**

| Dependência | Para quê |
|---|---|
| Electron e electron-builder | Janela gráfica e instalador para Windows |
| Python embutido | Distribuir Whisper e yt-dlp sem exigir Python instalado |
| Servidor de modelo local (por exemplo, Ollama) | Opcional: planejamento por IA sem serviço externo |

## 12. Decisões em aberto

- Quando usar Remotion ou HyperFrames em cada tipo de vídeo.
- Modelo do Whisper padrão para produção e por faixa de hardware.
- Modelos locais de linguagem e visão recomendados por faixa de VRAM.
- Estratégia de planejamento quando não há nenhum provedor de texto (regras fixas por perfil).
