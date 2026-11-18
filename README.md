# IA Editora de Vídeo

Editor de vídeo assistido por IA: recebe vídeos brutos, analisa e transcreve o
conteúdo, decide a edição, renderiza e verifica a qualidade antes de exportar.

> **Status:** primeira versão utilizável (0.1.0). Aplicação com janela própria, instalação,
> atualização e cópias de segurança: do vídeo bruto ao MP4 exportado e conferido, com
> memória e aprendizado, sem depender de nenhum outro programa aberto nem de serviço de IA.
> Testada em Linux com vídeos sintéticos; o instalador do Windows ainda não foi executado em
> um Windows real. Andamento: [docs/PROGRESSO.md](docs/PROGRESSO.md). Pendências:
> [docs/LIMITACOES.md](docs/LIMITACOES.md).

Roda no computador do usuário, sem depender de nenhum serviço de IA externo. O primeiro
foco são vídeos promocionais de servidores FiveM e RedM para Instagram e TikTok, tratados
como perfis configuráveis: o mesmo núcleo serve a qualquer tipo de vídeo.

## Estrutura

```
IAEditoraVideo/
├── Videos Brutos/        Material original (conteúdo fora do Git)
├── Referências/          Referências de estilo (conteúdo fora do Git)
├── Exportações/          Vídeos finais (conteúdo fora do Git)
├── Dados/                Banco, configurações, projetos e temporários (fora do Git)
├── src/
│   ├── dominio/          Tipos e contratos
│   ├── nucleo/           Aplicação e orquestrador do pipeline
│   ├── servicos/         Projetos, memória, aprendizado, acervo, perfis, provedores de IA
│   ├── infra/            Banco SQLite, cópias de segurança, caminhos, configurações
│   └── interface/        Janela (servidor local e página) e linha de comando
├── Pipeline/             Processamento audiovisual, agentes e motor de render
├── IA/Perfis/            Perfis de especialização (geral, fivem, redm e mais seis)
├── IA/Estilos/           Estilos de edição (gameplay, ação, trailer e mais sete)
├── exemplos/             Exemplos executáveis
├── IA/Qualidade/         Critérios de qualidade por destino
├── IA/Exportacao/        Presets de exportação
├── scripts/              Instalar, iniciar, parar, atualizar, backup, restaurar, setup e verificadores
├── windows/              Instalador e atalhos para Windows
├── config/               Configurações das ferramentas (sem segredos)
├── tests/                Testes de unidade e composições de teste
├── docs/                 Documentação
└── .claude/skills/       Skills de desenvolvimento (não fazem parte do produto)
```

A arquitetura está detalhada em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## IA local

A aplicação pode instalar uma **IA local**: um modelo aberto de visão e linguagem
(Qwen3-VL, licença Apache 2.0) que roda no próprio computador pelo motor llama.cpp, sem
internet e sem custo. Ela interpreta personagens, humor, enquadramentos e narrativa, e
redige o roteiro. É opcional: sem ela, essas leituras ficam como "não avaliado". Detalhes
em [docs/USO.md](docs/USO.md#ia-local-opcional-recomendada).

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

## Instalar e usar

**No Windows:** baixe o `IA-Editora-de-Video-Setup-<versão>.exe` na aba **Releases** do
GitHub e execute. O programa abre com uma tela de abertura que mostra a porcentagem, baixa
na primeira vez o que faltar (FFmpeg, Python e os pacotes do Whisper) e se atualiza sozinho
quando sai uma versão nova. Nenhuma janela de prompt aparece. Passo a passo em
[docs/INSTALACAO.md](docs/INSTALACAO.md); como publicar uma versão, em
[docs/LANCAMENTO.md](docs/LANCAMENTO.md).

**Pelo código-fonte** (desenvolvimento, ou Windows sem o instalador): `windows\Instalar.cmd`
instala Node.js, Git, FFmpeg e Python pelo winget e cria o atalho.

**Em macOS e Linux**, com Node.js 22.20+, Python 3.11+, FFmpeg e Git instalados:

```bash
npm run instalar
```

```bash
npm run iniciar
```

| Para | Windows | Qualquer sistema |
|---|---|---|
| Abrir o aplicativo (janela própria) | Atalho do `Setup.exe` | `npm run aplicativo` |
| Gerar o instalador | Fluxo "Lançamento" do GitHub | `npm run empacotar` (só no Windows) |
| Instalar ou reparar pelo código | `windows\Instalar.cmd` | `npm run instalar` |
| Abrir a aplicação | Atalho ou `windows\Iniciar.cmd` | `npm run iniciar` |
| Fechar | Botão Encerrar ou `windows\Parar.cmd` | `npm run parar` |
| Atualizar pelo GitHub | `windows\Atualizar.cmd` | `npm run atualizar` |
| Cópia de segurança | `windows\Backup.cmd` | `npm run backup` |
| Restaurar uma cópia | `windows\Restaurar.cmd` | `npm run restaurar` |

Guias: [instalação](docs/INSTALACAO.md), [utilização](docs/USO.md),
[atualização](docs/ATUALIZACAO.md), [cópia de segurança e restauração](docs/BACKUP.md) e
[limitações conhecidas](docs/LIMITACOES.md).

## Desenvolvimento

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

```bash
npm test
```

```bash
npm run app -- situacao
```

```bash
npm run exemplo:memoria
```

A janela cobre todos os recursos. Os mesmos recursos existem em comandos (lista completa
com `npm run app`):

| Comando | Função |
|---|---|
| `npm run app -- perfis` | Lista os perfis de especialização |
| `npm run app -- projeto criar "Nome" fivem` | Cria um projeto |
| `npm run app -- projeto listar` | Lista os projetos |
| `npm run app -- brutos importar <projeto>` | Registra no projeto os vídeos de `Videos Brutos/` |
| `npm run app -- brutos analisar <projeto>` | Examina, analisa e indexa os vídeos brutos |
| `npm run app -- pesquisar <palavras>` | Pesquisa nos vídeos brutos |
| `npm run app -- plano gerar <projeto> "objetivo"` | Gera um plano de edição |
| `npm run app -- plano aprovar <projeto>` | Aprova o plano atual |
| `npm run app -- roteiro <projeto>` | Escreve o roteiro do plano |
| `npm run app -- montar <projeto> --estilo acao` | Monta a timeline do plano aprovado |
| `npm run app -- editar <projeto> '<operação>'` | Altera a timeline (nova versão) |
| `npm run app -- previa <projeto>` | Renderiza uma prévia de baixa qualidade |
| `npm run app -- qualidade <projeto>` | Confere a timeline antes de renderizar |
| `npm run app -- presets` | Lista os presets de exportação e os destinos |
| `npm run app -- exportar <projeto> --preset vertical-1080` | Renderiza o vídeo final em MP4, confere e mostra o relatório |
| `npm run app -- relatorio <exportação>` | Relatório de qualidade de uma exportação |
| `npm run app -- aceitar <relatório> <verificação> "motivo"` | Aceita um problema não crítico |
| `npm run app -- repetir <exportação>` | Repete uma exportação, sem sobrescrever |
| `npm run app -- exportacoes <projeto>` | Histórico de exportações |
| `npm run app -- avaliar <projeto> aprovar "motivo"` | Avalia a edição (aprovar, rejeitar ou alterar) |
| `npm run app -- comparar <projeto> 1 3` | Compara duas versões da timeline |
| `npm run app -- resultado <projeto> Instagram --retencaoPercentual 48` | Registra métricas informadas |
| `npm run app -- aprendido` | Mostra o que foi aprendido, por contexto |
| `npm run app -- referencias importar` | Registra os vídeos novos da pasta `Referências/` |
| `npm run app -- referencias analisar todas` | Analisa as referências e grava os relatórios |
| `npm run app -- aprendizados` | Lista o que a IA aprendeu |
| `npm run app -- backup` | Grava uma cópia de segurança |
| `npm run app -- backup listar` | Lista as cópias |
| `npm run app -- backup restaurar <nome>` | Restaura uma cópia |

Documentação por assunto: memória e aprendizado em [docs/MEMORIA.md](docs/MEMORIA.md);
análise de referências em [docs/REFERENCIAS.md](docs/REFERENCIAS.md); vídeos brutos, plano
de edição, aprovação e roteiro em [docs/PRODUCAO.md](docs/PRODUCAO.md); timeline, estilos,
prévia e renderização em [docs/EDICAO.md](docs/EDICAO.md); controle de qualidade, destinos,
presets e exportação em [docs/QUALIDADE.md](docs/QUALIDADE.md); avaliação das edições,
métricas e controle do aprendizado em [docs/FEEDBACK.md](docs/FEEDBACK.md).

Instalação, verificação, aceleração por GPU e uso de cada ferramenta estão em
[docs/AMBIENTE.md](docs/AMBIENTE.md).

## Regras do repositório

- Vídeos, áudios, renders, pesos de modelos e caches **não** são versionados.
- Credenciais ficam em `.env` (ignorado). Nunca faça commit de chaves ou tokens.
- Arquivos em `Videos Brutos/` são tratados como somente leitura.
