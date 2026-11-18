# Aplicativo Windows (.exe, tela de abertura e atualização automática) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A IA Editora de Vídeo vira um programa Windows de verdade: instalador `.exe`,
abre sem nenhuma janela de prompt, mostra uma tela de abertura com porcentagem e se
atualiza sozinha a partir dos lançamentos publicados no GitHub.

**Architecture:** Um invólucro Electron (`aplicativo/`) passa a ser o programa que o usuário
abre. Ele mostra a tela de abertura, prepara o computador na primeira vez, inicia o
servidor atual (`src/interface/principal.ts`) como processo filho sem console, rodando o
próprio executável como Node (`ELECTRON_RUN_AS_NODE`), e exibe a página em janela própria.
A atualização usa `electron-updater` com lançamentos do GitHub, gerados por um fluxo do
GitHub Actions num executor Windows, que também faz o primeiro teste real em Windows. Todo o
estado da máquina sai da pasta do programa, que a atualização substitui.

**Tech Stack:** Electron (invólucro e janela), electron-builder (instalador NSIS),
electron-updater (atualização), GitHub Actions `windows-latest` (compilação, teste de
fumaça e publicação). O resto continua como está: Node + TypeScript sem compilação, Remotion,
FFmpeg, Python (Whisper), llama.cpp.

**Spec:** pedido do usuário de 18/11/2026 ("deixar de tudo ser executado num prompt para se
tornar um .exe; tela de loading inicial; .exe ser atualizado automaticamente com base no
repositório") e o mapa [docs/MAPA.md](../../MAPA.md), seção 4.

## Decisão pendente (do usuário) — onde publicar os lançamentos

O repositório é **privado**. O atualizador baixa os lançamentos sem login, então eles
precisam estar num lugar público, ou o programa precisaria carregar uma senha do GitHub.

| Opção | Efeito |
|---|---|
| **A. Repositório público só para lançamentos** (recomendada) | `PauloRiello/IAEditoraVideo-lancamentos` recebe só os instaladores; o código continua privado |
| B. Tornar este repositório público | O código fica visível para qualquer pessoa |
| C. Senha de leitura dentro do programa | Quem tiver o `.exe` consegue ler o código; não recomendado |

O plano usa a opção A. Trocar é uma linha (`publish` em `electron-builder.yml`, Tarefa 6).

## Global Constraints

- Nenhuma janela de prompt aparece em uso normal (abrir, analisar, prévia, exportar, atualizar).
- Nada que a aplicação precisa guardar fica na pasta do programa: dados em `%LOCALAPPDATA%\IAEditoraVideo`, ambiente da máquina (Python, FFmpeg, aceleração) em `%LOCALAPPDATA%\IAEditoraVideo\ambiente`.
- A atualização nunca perde dados: cópia de segurança "pre-atualizacao" antes de instalar; migração do banco com a cópia "pre-migracao" que já existe.
- Todo trabalho demorado mostra porcentagem e etapa (regra do `CLAUDE.md`), inclusive a primeira preparação e o download da atualização.
- A abertura por `npm run iniciar` (desenvolvimento, Linux, macOS) continua funcionando.
- Versões fixas (sem `^`) para `electron`, `electron-builder` e `electron-updater`; justificativa registrada em `docs/ARQUITETURA.md`.
- Scripts de `scripts/` continuam só com módulos nativos do Node; o invólucro (`aplicativo/`) pode usar Electron e `electron-updater`.
- O produto continua independente do Claude e sem API de IA obrigatória.

## Review Focus

1. **Atualização baixada durante um render ou análise:** não instala no meio; pergunta "Atualizar agora ou ao fechar?" e, ao fechar, espera o trabalho terminar ou ser cancelado com segurança. (Teste na Tarefa 5.)
2. **Clique duplo no `.exe` com o programa aberto:** traz a janela existente para a frente; nunca um segundo servidor. (Teste na Tarefa 5.)
3. **Primeira abertura sem internet:** a preparação falha com mensagem clara e botão "Tentar de novo"; o que já foi baixado continua de onde parou; o programa abre com os recursos que não dependem do que faltou. (Teste na Tarefa 3.)
4. **Dados de uma instalação anterior pelo `Instalar.cmd`** (mesma pasta de dados): são reaproveitados, com migração e cópia antes. (Teste na Tarefa 1.)
5. **Servidor que fecha ao iniciar (antivírus, arquivo corrompido):** a tela de abertura mostra o erro e as últimas linhas do registro, com "Tentar de novo"; nunca fica girando para sempre. (Teste na Tarefa 4.)

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/dominio/estilos.ts` (novo) | Tipo `EstiloDeEdicao`, hoje em `src/servicos/estilos.ts` (corrige a camada violada) |
| `src/infra/caminhos.ts` | Ganha `ambiente`: pasta do Python, FFmpeg e `aceleracao.json` |
| `src/infra/download.ts` (novo) | Download com SHA-256, retomada e progresso, extraído de `src/servicos/ia-local.ts` |
| `src/servicos/ambiente.ts` (novo) | Preparação da máquina: FFmpeg, Python, ambiente virtual, pacotes, aceleração |
| `IA/Ambiente/ferramentas.json` (novo) | FFmpeg e Python portáteis: versão, endereço, tamanho, SHA-256 |
| `src/interface/preparar.ts` (novo) | Entrada da preparação, com progresso em linhas JSON; não importa Remotion |
| `src/interface/principal.ts` | Modo "anfitrião": avisa por linha JSON quando está pronto e encerra se o invólucro fechar |
| `aplicativo/principal.mjs` (novo) | Invólucro Electron: instância única, abertura, preparação, servidor, janela, encerramento |
| `aplicativo/estado.mjs` (novo) | Lógica pura do invólucro (ambiente do servidor, leitura das linhas, textos), testável sem Electron |
| `aplicativo/atualizacao.mjs` (novo) | `electron-updater`: verificar, baixar com %, cópia antes, instalar |
| `aplicativo/abertura.html`, `abertura.js` (novos) | Tela de abertura |
| `aplicativo/ponte.cjs` (novo) | `preload`: expõe à página a versão e o estado da atualização |
| `electron-builder.yml` (novo) | Instalador NSIS por usuário, atalho, publicação |
| `.github/workflows/lancamento.yml` (novo) | Compilar, testar no Windows e publicar |

---

### Task 1: Estado da máquina fora da pasta do programa (e camada corrigida)

**Files:**
- Create: `src/dominio/estilos.ts`
- Modify: `src/servicos/estilos.ts` (reexporta o tipo), `Pipeline/editing/montagem.ts:8`, `src/infra/caminhos.ts`, `src/nucleo/aplicacao.ts:107`, `Pipeline/transcription/whisper.ts:24`, `src/nucleo/transcricao.ts:20`, `scripts/lib/comum.mjs` (`ARQUIVO_ACELERACAO`, `binVenv`), `scripts/detectar_gpu.mjs`, `remotion.config.ts:13`
- Test: `tests/unidade/ambiente.test.ts`

**Interfaces:**
- Produces: `Caminhos.ambiente: string` (padrão: `<dados>/ambiente`; com `IAEV_AMBIENTE`, o valor dela); `caminhoDaAceleracao(c: Caminhos): string`; `pythonDoAmbiente(c: Caminhos): string | null` (procura `<ambiente>/python` e, se não houver, o `.venv` da pasta do programa); em `scripts/lib/comum.mjs`, `ARQUIVO_ACELERACAO` e `binVenv` passam a respeitar `IAEV_AMBIENTE`.

- [ ] **Step 1:** Teste `"o ambiente da máquina fica na pasta de dados, com volta à pasta do programa para instalações antigas"`: com `IAEV_AMBIENTE` apontando para uma pasta temporária, `caminhoDaAceleracao` e `pythonDoAmbiente` resolvem lá; sem ela e com um `.venv` na pasta do programa, `pythonDoAmbiente` devolve o antigo; `Aplicacao` lê a aceleração do caminho novo; os dados de uma instalação anterior na mesma pasta abrem com a migração e a cópia "pre-migracao" (Review Focus 4).
- [ ] **Step 2:** `npm test -- tests/unidade/ambiente.test.ts` falha.
- [ ] **Step 3:** Mover `EstiloDeEdicao` para `src/dominio/estilos.ts`, reexportar de `src/servicos/estilos.ts` e importar do domínio em `montagem.ts`. Implementar `ambiente`, `caminhoDaAceleracao` e `pythonDoAmbiente`; trocar os cinco usos listados em Files.
- [ ] **Step 4:** `npm run typecheck` e `npm test` passam; `node scripts/verificar/gpu.mjs` grava em `IAEV_AMBIENTE` quando ela existe.
- [ ] **Step 5:** Commit `"Estado da máquina fora da pasta do programa; tipo de estilo no domínio"`.

### Task 2: Download compartilhado

**Files:**
- Create: `src/infra/download.ts`
- Modify: `src/servicos/ia-local.ts` (passa a importar)
- Test: `tests/unidade/ia-local.test.ts` (continua passando sem mudança), `tests/unidade/ambiente.test.ts`

**Interfaces:**
- Produces: `baixar(url: string, destino: string, esperado: { arquivo: string; tamanho: number; sha256: string }, aoProgredir: (bytes: number) => void, sinal?: AbortSignal): Promise<void>`; `tamanhoLegivel(bytes: number): string`; `desempacotar(arquivo: string, pasta: string): Promise<void>`. Mesmo comportamento atual (retomada por `Range`, descarte se a soma não confere, `tar` do Windows).

- [ ] **Step 1:** Mover sem mudar comportamento; os 8 testes de `ia-local.test.ts` são a rede de segurança.
- [ ] **Step 2:** `npm test` passa; commit `"Download conferido e retomável em src/infra/download.ts"`.

### Task 3: Preparação da máquina com porcentagem

**Files:**
- Create: `src/servicos/ambiente.ts`, `src/interface/preparar.ts`, `IA/Ambiente/ferramentas.json`
- Modify: `scripts/configurar_ambiente.mjs` (depois do `npm install`, chama `preparar.ts`), `requirements.txt` (sem mudança de conteúdo)
- Test: `tests/unidade/ambiente.test.ts`

**Interfaces:**
- Consumes: Task 1 (`Caminhos.ambiente`), Task 2 (`baixar`, `desempacotar`).
- Produces: `prepararAmbiente(opcoes: { caminhos: Caminhos; aoProgredir: (etapa: string, fracao: number) => void; sinal?: AbortSignal; origens?: Record<string, string> }): Promise<SituacaoDoAmbiente>`; `situacaoDoAmbiente(c: Caminhos): SituacaoDoAmbiente` com `{ ffmpeg: boolean; python: boolean; whisper: boolean; aceleracao: boolean; faltando: string[] }`. `preparar.ts` imprime uma linha JSON por aviso: `{"etapa": string, "fracao": number}`, e no fim `{"pronto": true, "faltando": string[]}` ou `{"erro": string}`.
- Etapas e frações: FFmpeg 0–0,25 (só se não houver no sistema), Python portátil 0,25–0,40 (só se não houver Python 3.11+), ambiente virtual 0,40–0,45, pacotes 0,45–0,85 (fração = pacotes concluídos / pacotes do `requirements.txt`, lendo as linhas "Successfully installed"/"Requirement already satisfied" do pip), aceleração 0,85–0,95 (`scripts/detectar_gpu.mjs`), bibliotecas CUDA 0,95–1 (só com NVIDIA).
- `IA/Ambiente/ferramentas.json`: FFmpeg "essentials" do gyan.dev e Python do projeto python-build-standalone ("install_only", Windows x64), cada um com versão, endereço, tamanho e SHA-256 registrados por quem implementar, baixando o arquivo uma vez.

- [ ] **Step 1:** Testes com servidor local (como em `ia-local.test.ts`) e ferramentas falsas: `"prepara o que falta, na ordem, com a porcentagem só avançando"`; `"o que já existe não é baixado de novo"`; `"sem internet: erro claro, o resto abre, e a segunda tentativa continua de onde parou"` (Review Focus 3); `"preparar.ts fala em linhas JSON e termina com pronto ou erro"`.
- [ ] **Step 2:** Os testes falham.
- [ ] **Step 3:** Implementar `prepararAmbiente`, `situacaoDoAmbiente` e `preparar.ts`; `configurar_ambiente.mjs` passa a delegar a ele as partes que não são `npm install`.
- [ ] **Step 4:** `npm test` passa; `npm run setup` continua funcionando no desenvolvimento.
- [ ] **Step 5:** Commit `"Preparação da máquina com porcentagem, reaproveitada pelo setup e pelo aplicativo"`.

### Task 4: Servidor em modo anfitrião

**Files:**
- Modify: `src/interface/principal.ts`
- Test: `tests/unidade/interface.test.ts` (ou `tests/unidade/anfitriao.test.ts`)

**Interfaces:**
- Produces: com `IAEV_ANFITRIAO=1`, `principal.ts` imprime `{"etapa": "Abrindo os dados", "fracao": 0.2}` antes de criar a `Aplicacao`, `{"etapa": "Ligando o servidor", "fracao": 0.8}` depois, e `{"pronta": true, "porta": number, "token": string, "avisos": string[]}` quando atende; em falha, `{"erro": string}` e código 1. Se a entrada padrão fechar (o invólucro morreu), encerra com `servidor.encerrar()`.

- [ ] **Step 1:** Testes: `"no modo anfitrião, avisa pronta com porta e sessão"`; `"fechar a entrada padrão encerra o servidor e apaga execucao.json"`; `"erro ao abrir vira uma linha {erro} e código 1"` (com uma pasta de dados ilegível; Review Focus 5).
- [ ] **Step 2:** Falham. **Step 3:** Implementar. **Step 4:** `npm test` passa.
- [ ] **Step 5:** Commit `"Servidor em modo anfitrião para o aplicativo"`.

### Task 5: Invólucro Electron e tela de abertura

**Files:**
- Create: `aplicativo/principal.mjs`, `aplicativo/estado.mjs`, `aplicativo/abertura.html`, `aplicativo/abertura.js`, `aplicativo/ponte.cjs`
- Modify: `package.json` (`"main": "aplicativo/principal.mjs"`, script `"aplicativo": "electron ."`, `electron` fixo em `devDependencies`)
- Test: `tests/unidade/aplicativo.test.ts` (só `estado.mjs`; o Electron em si é testado na Tarefa 7)

**Interfaces:**
- Consumes: Task 3 (`preparar.ts` e suas linhas), Task 4 (linhas do anfitrião).
- Produces, em `estado.mjs`: `ambienteDoServidor(o: { execPath: string; dados: string; biblioteca: string; ambiente: string; pathAtual: string }): Record<string, string>` (inclui `ELECTRON_RUN_AS_NODE=1`, `IAEV_ANFITRIAO=1`, `IAEV_INSTALADO=1`, `IAEV_DADOS`, `IAEV_BIBLIOTECA`, `IAEV_AMBIENTE`, e o `PATH` com `<ambiente>/ferramentas/ffmpeg/bin` na frente); `lerLinha(linha: string): { tipo: "etapa"; etapa: string; fracao: number } | { tipo: "pronta"; porta: number; token: string; avisos: string[] } | { tipo: "erro"; mensagem: string } | null`; `fracaoDaAbertura(fase: "preparando" | "abrindo", fracao: number): number` (preparação ocupa 0–0,7 da barra; abertura, 0,7–1); `podeInstalarAgora(tarefas: { estado: string }[]): boolean`.
- Comportamento de `principal.mjs`:
  - `app.requestSingleInstanceLock()`: a segunda instância só traz a janela existente para a frente (Review Focus 2).
  - Mostra `abertura.html` (sem moldura, 520×320, com logotipo, etapa e barra com %, reaproveitando as cores de `src/interface/web/estilo.css`).
  - Se `situacaoDoAmbiente` indicar falta, roda `preparar.ts`; depois inicia `principal.ts` com `spawn(process.execPath, …, { env: ambienteDoServidor(…), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] })`. O console invisível que isso cria é herdado por Remotion, FFmpeg e navegador de render: nenhuma janela de prompt.
  - Com `pronta`, abre a `BrowserWindow` em `http://127.0.0.1:porta/?t=token` e fecha a abertura.
  - Com erro, a abertura mostra a mensagem, as últimas linhas do registro e "Tentar de novo" (Review Focus 5).
  - Ao fechar a janela: `POST /api/encerrar` e espera o processo sair (até 30 s).
- Dados: `%LOCALAPPDATA%\IAEditoraVideo` (a mesma pasta das instalações pelo `Instalar.cmd`, reaproveitada); biblioteca em `Documentos\IA Editora de Video`, guardada em `<userData>/aplicativo.json`.

- [ ] **Step 1:** Testes de `estado.mjs`: `"ambiente do servidor"` (variáveis e `PATH`), `"leitura das linhas"` (as três formas e lixo devolvendo `null`), `"barra da abertura só avança de 0 a 100%"`, `"não instala atualização com render ou análise em andamento"` (Review Focus 1).
- [ ] **Step 2:** Falham. **Step 3:** Implementar `estado.mjs`, depois `principal.mjs`, a abertura e a ponte.
- [ ] **Step 4:** `npm test` passa. `npm run aplicativo` abre em Linux com tela (verificação manual no executor da Tarefa 7, se este ambiente não permitir executar o Electron baixado).
- [ ] **Step 5:** Commit `"Aplicativo: invólucro Electron com tela de abertura e servidor sem console"`.

### Task 6: Atualização automática

**Files:**
- Create: `aplicativo/atualizacao.mjs`, `electron-builder.yml`
- Modify: `aplicativo/principal.mjs`, `aplicativo/ponte.cjs`, `src/interface/web/telas/configuracoes.js` (seção "Sobre": versão, estado da atualização, botão "Reiniciar e atualizar" quando `window.iaevAplicativo` existir), `package.json` (`electron-updater` fixo em `dependencies`, `electron-builder` em `devDependencies`, scripts `"empacotar": "electron-builder --win"`)
- Test: `tests/unidade/aplicativo.test.ts`

**Interfaces:**
- Produces: `textoDaAtualizacao(e: { tipo: "verificando" | "disponivel" | "baixando" | "baixada" | "sem-novidade" | "erro"; versao?: string; fracao?: number; mensagem?: string }): string` em `estado.mjs` (ex.: `"Baixando a versão 0.2.0: 37%"`). `window.iaevAplicativo`: `{ versao: string; aoMudarAtualizacao(f: (texto: string, pronta: boolean) => void): void; reiniciarParaAtualizar(): void }`.
- Comportamento: verifica ao abrir e a cada 6 h; baixa em segundo plano com %; ao terminar, avisa na página; instala ao fechar ou ao clicar em "Reiniciar e atualizar", sempre depois de `POST /api/backups` (cópia "manual") e só quando `podeInstalarAgora` permitir. Erros de rede na verificação só vão para o registro.
- `electron-builder.yml`: `appId: br.iaeditora.video`, `productName: "IA Editora de Vídeo"`, `asar: false` (o servidor lê os `.ts` e o Remotion executa binários de `node_modules`), arquivos `src/`, `Pipeline/`, `IA/`, `aplicativo/`, `scripts/`, `config/` sem `local.*`, `remotion.config.ts`, `package.json`; `nsis: { oneClick: true, perMachine: false, createDesktopShortcut: true, shortcutName: "IA Editora de Video" }`; ícone `src/interface/web/icone.ico`; `publish: { provider: github, owner: PauloRiello, repo: IAEditoraVideo-lancamentos }` (decisão pendente).

- [ ] **Step 1:** Testes de `textoDaAtualizacao` para os seis tipos, com os textos exatos.
- [ ] **Step 2:** Falham. **Step 3:** Implementar.
- [ ] **Step 4:** `npm test` passa; `npx electron-builder --win --dir` gera a pasta do programa no executor da Tarefa 7.
- [ ] **Step 5:** Commit `"Atualização automática pelos lançamentos do GitHub"`.

### Task 7: Lançamento e primeiro teste real no Windows

**Files:**
- Create: `.github/workflows/lancamento.yml`, `docs/LANCAMENTO.md`
- Modify: `aplicativo/principal.mjs` (opção `--teste-de-fumaca`: abre sem janela visível, espera `pronta`, chama `/api/saude` e `/api/painel`, grava o resultado num arquivo e fecha)

**Interfaces:**
- Consumes: Tarefas 5 e 6.
- Fluxo (executor `windows-latest`), disparado por etiqueta `v*` e manualmente: `npm ci` → `npm run typecheck` → `npx electron-builder --win --publish never` → instalar em silêncio (`"IA Editora de Video Setup <versão>.exe" /S`) → abrir o programa instalado com `--teste-de-fumaca` → conferir o arquivo de resultado → publicar (`electron-builder --win --publish always`, com `GH_TOKEN` do segredo `LANCAMENTO_TOKEN`) só se tudo passou.
- `docs/LANCAMENTO.md`: como lançar uma versão (`npm version minor`, `git push --tags`), o que o fluxo faz e o que fazer se falhar.

- [ ] **Step 1:** Escrever o fluxo e a opção `--teste-de-fumaca`.
- [ ] **Step 2:** Disparar manualmente no ramo; o teste de fumaça passa no Windows (primeira execução real da aplicação em Windows feita pelo projeto).
- [ ] **Step 3:** Commit `"Lançamento: compilação, teste de fumaça no Windows e publicação"`.

### Task 8: Documentação

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/INSTALACAO.md` (baixar e executar o `Setup.exe`; `Instalar.cmd` fica para desenvolvimento), `docs/ATUALIZACAO.md` (automática; a por Git fica para desenvolvimento), `docs/ARQUITETURA.md` (seção 10 e dependências novas com justificativa), `docs/LIMITACOES.md` (sem assinatura digital: o Windows mostra "Windows protegeu o computador" na primeira vez), `docs/MAPA.md`, `docs/PROGRESSO.md`

- [ ] **Step 1:** Atualizar; `python3 -m unittest discover -s tests` passa.
- [ ] **Step 2:** Commit `"Documentação do aplicativo Windows"`.
