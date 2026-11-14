# IA Editora de Vídeo

Editor de vídeo assistido por IA: recebe vídeos brutos, analisa e transcreve o
conteúdo, decide a edição, renderiza e verifica a qualidade antes de exportar.

> **Status:** do vídeo bruto ao MP4 exportado, pela linha de comando: análise, plano,
> aprovação, timeline editável, prévia, renderização e aprendizado com o feedback, tudo
> testado. Ainda não há interface gráfica nem instalador. Andamento: [docs/PROGRESSO.md](docs/PROGRESSO.md).

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
│   └── interface/        Linha de comando (janela gráfica futura)
├── Pipeline/             Processamento audiovisual, agentes e motor de render
├── IA/Perfis/            Perfis de especialização (geral, fivem, redm e mais cinco)
├── IA/Estilos/           Estilos de edição (gameplay, ação, trailer e mais sete)
├── exemplos/             Exemplos executáveis
├── scripts/              Setup, detecção de GPU e verificadores
├── config/               Configurações das ferramentas (sem segredos)
├── tests/                Testes de unidade e composições de teste
├── docs/                 Documentação
└── .claude/skills/       Skills de desenvolvimento (não fazem parte do produto)
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

```bash
npm test
```

```bash
npm run app -- situacao
```

```bash
npm run exemplo:memoria
```

Outros comandos da aplicação (lista completa com `npm run app`):

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
| `npm run app -- exportar <projeto>` | Renderiza o vídeo final em MP4 |
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
prévia e renderização em [docs/EDICAO.md](docs/EDICAO.md); avaliação das edições, métricas
e controle do aprendizado em [docs/FEEDBACK.md](docs/FEEDBACK.md).

Instalação, verificação, aceleração por GPU e uso de cada ferramenta estão em
[docs/AMBIENTE.md](docs/AMBIENTE.md).

## Regras do repositório

- Vídeos, áudios, renders, pesos de modelos e caches **não** são versionados.
- Credenciais ficam em `.env` (ignorado). Nunca faça commit de chaves ou tokens.
- Arquivos em `Videos Brutos/` são tratados como somente leitura.
