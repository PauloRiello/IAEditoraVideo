# Referências por link — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colar links do YouTube, TikTok ou Instagram e obter referências baixadas, com porcentagem, prontas para analisar.

**Architecture:** `Pipeline/ingestion/links.ts` roda o yt-dlp do ambiente em duas chamadas (metadados com `-J`, depois o download com andamento em linhas) e classifica erros; `AnaliseDeReferencias.baixarDeLink` (núcleo) normaliza o link, evita repetição, registra a referência e o vínculo com o projeto; a rota e a CLI criam tarefas com porcentagem; a janela só mostra o campo e as tarefas.

**Tech Stack:** yt-dlp (já em `requirements.txt`), Node + TypeScript sem compilação, página em JS puro.

**Spec:** [docs/superpowers/specs/2026-11-18-identidade-visual-e-referencias-por-link-design.md](../specs/2026-11-18-identidade-visual-e-referencias-por-link-design.md), Parte 1.

## Global Constraints

- Ferramentas que leem/escrevem mídia só em `Pipeline/`; a janela não decide nada; camadas interface → núcleo → serviços → infra.
- Sem login: nada de cookies, `cookies.txt` ou leitura do navegador.
- Todo download é tarefa com etapa e fração de 0 a 1, nunca sem número (`app.tarefas.iniciar`, `barra()`/`atualizarBarra()`, `progresso()` na CLI).
- Mensagem de login, exatamente: "O Instagram só deixa baixar esse vídeo com login. Salve o vídeo pelo celular ou pelo navegador e arraste o arquivo para cá." (com o nome do site trocado conforme o link: "O TikTok", "O YouTube", "O Instagram").
- Autorização gravada: `Baixado de <Site> em <dd/mm/aaaa> para análise como referência (ensina princípio, não cópia).`
- Até 1080p, MP4 com áudio, sem playlist (`config/yt-dlp.conf`).
- O yt-dlp é o do Python do ambiente (`pythonDoAmbiente`); no `.exe` não há Node instalado: `--js-runtimes node:<process.execPath>`.
- Análise não começa sozinha.

## Review Focus

1. **Link com parâmetros de rastreio ou em outra forma** (`youtu.be/ID?si=…`, `/shorts/ID`, `instagram.com/reel/X/?igsh=…`): é a mesma referência; nada é baixado de novo. (Teste na Tarefa 1 e na 2.)
2. **Link de playlist ou de perfil** (`youtube.com/playlist?list=…`, `tiktok.com/@perfil`): recusado com mensagem clara, sem baixar vários vídeos. (Teste na Tarefa 1.)
3. **Internet cai no meio do download:** a tarefa falha com "sem conexão", o arquivo pela metade não vira referência, e baixar de novo continua do `.part` (o yt-dlp continua por padrão). (Teste na Tarefa 1.)
4. **Python/yt-dlp ausente** (preparação incompleta): mensagem "O baixador de vídeos ainda não está instalado. Feche e abra o programa com internet para terminar a preparação.", sem exceção crua. (Teste na Tarefa 2.)
5. **Vários links colados de uma vez, um deles inválido:** os válidos são baixados; o inválido aparece como tarefa com erro, sem impedir os outros. (Teste na Tarefa 2.)

---

### Task 1: Baixador de links (Pipeline)

**Files:**
- Create: `Pipeline/ingestion/links.ts`
- Test: `tests/unidade/links.test.ts`

**Interfaces:**
- Produces:
  - `normalizarLink(url: string): { url: string; site: "youtube" | "tiktok" | "instagram" | "outro" } | { erro: "lista" | "invalido" }` — YouTube vira `https://www.youtube.com/watch?v=<id>` (de `youtu.be/<id>`, `/shorts/<id>`, `m.`/sem `www`, sem `si`, `t`, `feature`, `utm_*`); Instagram e TikTok perdem a query e a barra final; host em minúsculas; `list=` sem `v=`, `/playlist`, `/@perfil` sem `/video/`, `instagram.com/<perfil>/` → `"lista"`; não-http(s) → `"invalido"`.
  - `lerAndamento(linha: string): { baixados: number; total: number } | null` para linhas `IAEV <baixados> <total>` (emitidas por `--progress-template "download:IAEV %(progress.downloaded_bytes)s %(progress.total_bytes,progress.total_bytes_estimate)s"`; total `NA` → `null`).
  - `classificarErro(saida: string): "login" | "indisponivel" | "invalido" | "sem-conexao" | "desconhecido"` — padrões: login (`login required`, `Sign in to confirm`, `rate-limit reached or login required`, `--cookies`), indisponível (`Private video`, `Video unavailable`, `has been removed`, `not available`), inválido (`Unsupported URL`), sem conexão (`Unable to download`, `getaddrinfo`, `timed out`, `Connection reset`).
  - `baixarLink(url: string, o: { pasta: string; ytDlp: string; jsRuntime: string; configuracao: string; aoAvancar: (etapa: string, fracao: number) => void; sinal?: AbortSignal }): Promise<{ arquivo: string; titulo: string; autor: string; data: string; site: string; urlOriginal: string }>` — 1) `-J --no-download` para metadados e número de arquivos (`requested_formats.length` ou 1); 2) download com `--newline` e o template acima, fração geral `0.05 + 0.9 × (arquivosConcluidos + baixados/total) / numeroDeArquivos`, "Juntando áudio e vídeo" em 0,96; 3) arquivo final por `--print after_move:filepath`. Erros viram `ErroAplicacao` com o código de `classificarErro` e a mensagem do Global Constraints (login) ou equivalente simples.

- [ ] **Step 1:** Testes:
  - `"normaliza links do YouTube, Instagram e TikTok"` — `youtu.be/abc?si=x` e `https://m.youtube.com/shorts/abc?feature=share` → `https://www.youtube.com/watch?v=abc`; `https://www.instagram.com/reel/XyZ/?igsh=1` → `https://www.instagram.com/reel/XyZ`; `https://www.tiktok.com/@a/video/123?lang=pt` → `https://www.tiktok.com/@a/video/123`.
  - `"recusa listas e perfis"` — `youtube.com/playlist?list=PL1`, `https://www.tiktok.com/@perfil`, `https://www.instagram.com/perfil/` → `{ erro: "lista" }`; `ftp://x` → `{ erro: "invalido" }` (Review Focus 2).
  - `"lê o andamento e classifica erros"` — `lerAndamento("IAEV 512 1024")` → `{ baixados: 512, total: 1024 }`; `"IAEV 10 NA"` → `null`; cada padrão de erro acima → seu código.
  - Fora do Windows, com um yt-dlp falso (script de shell que responde `-J` com JSON fixo de 2 `requested_formats`, emite linhas `IAEV`, cria o arquivo e imprime o caminho; e um modo que imprime `Sign in to confirm` no stderr e sai com 1; e um que imprime `Unable to download webpage: timed out` depois de metade do andamento): `"baixa com porcentagem só avançando e devolve os metadados"`, `"login exigido vira a mensagem do Instagram"`, `"internet caiu: erro sem-conexao e nenhum arquivo final"` (Review Focus 3).
- [ ] **Step 2:** `node --test tests/unidade/links.test.ts` falha (módulo inexistente).
- [ ] **Step 3:** Implementar `Pipeline/ingestion/links.ts` (spawn com `windowsHide`, `--config-locations <configuracao>`, `--paths <pasta>`, `--js-runtimes node:<jsRuntime>`, `ELECTRON_RUN_AS_NODE` herdado do ambiente).
- [ ] **Step 4:** Os testes passam; `npm run typecheck`.
- [ ] **Step 5:** Commit `"Baixador de links de referência com porcentagem e erros em linguagem simples"`.

### Task 2: Núcleo, rota e linha de comando

**Files:**
- Modify: `src/nucleo/referencias.ts`, `src/servicos/acervo.ts` (busca por `origemUrl`), `src/interface/rotas.ts`, `src/interface/cli.ts`
- Test: `tests/unidade/referencias.test.ts` (ou `links.test.ts`), `tests/unidade/interface.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `ServicoAcervo.referenciaPorOrigem(url: string): Referencia | null`.
  - `AnaliseDeReferencias.baixarDeLink(url: string, dados: { perfil?: string; projetoId?: string }, aoAvancar: (etapa: string, fracao: number) => void, sinal?: AbortSignal): Promise<{ referencia: Referencia; jaExistia: boolean }>` — normaliza; repetida → devolve a existente com `jaExistia: true` (e vincula ao projeto); senão baixa em `<referencias>[/<perfil>]`, registra com `origemUrl` normalizada, `titulo`, `notas` = `"<autor> · <data> · <site>"`, autorização do Global Constraints; vincula ao projeto. Sem yt-dlp no ambiente → `ErroAplicacao("baixador-ausente", <mensagem do Review Focus 4>)`. O yt-dlp é `dirname(pythonDoAmbiente(c))/yt-dlp[.exe]`; `jsRuntime` = `process.execPath`; configuração = `<programa>/config/yt-dlp.conf`. Dependências ganham uma opção de teste `ytDlp?: string`.
  - `POST /api/referencias/links` corpo `{ links: string; perfil?: string; projeto?: string }` (texto com um link por linha, linhas vazias ignoradas) → `{ tarefas: TarefaIniciada[] }`, uma tarefa por link (`tipo: "download-de-referencia"`, título `Baixando referência: <url>`), registra atividade ao terminar ("Referência "<título>" baixada de <site>." / "já existia").
  - CLI `referencias baixar <link> [--perfil X]` com `progresso()`.

- [ ] **Step 1:** Testes: `"link já baixado em outra forma não baixa de novo"` (Review Focus 1); `"sem yt-dlp no ambiente: mensagem para terminar a preparação"` (Review Focus 4); em `interface.test.ts`, `"vários links, um inválido: os outros baixam e o inválido vira tarefa com erro"` (Review Focus 5) com o yt-dlp falso; `"a referência baixada guarda origem, autor e autorização"`.
- [ ] **Step 2:** Falham. **Step 3:** Implementar. **Step 4:** `npm test` e `npm run typecheck` passam.
- [ ] **Step 5:** Commit `"Referências por link no núcleo, na API e na linha de comando"`.

### Task 3: Janela e documentação

**Files:**
- Modify: `src/interface/web/telas/referencias.js`, `src/interface/web/telas/projeto-material.js`, `docs/REFERENCIAS.md`, `docs/USO.md`, `docs/LIMITACOES.md` (login, sites que mudam), `docs/PROGRESSO.md`, `README.md`

**Interfaces:**
- Consumes: Task 2 (`POST /api/referencias/links`, eventos `tarefa:atualizada` de `tipo: "download-de-referencia"`).

- [ ] **Step 1:** Em Referências (e na aba de material do projeto, passando `projeto`): área de texto "Cole um ou mais links (um por linha)", seletor de perfil (o mesmo do envio de arquivo), botão "Baixar". Cada tarefa aparece com `barra()` e é atualizada por `atualizarBarra()`; ao concluir, a lista recarrega; erro mostra a mensagem da tarefa.
- [ ] **Step 2:** Conferir no navegador de verdade (Playwright, como nas etapas anteriores) com o yt-dlp falso via `IAEV_TESTE_YTDLP` **ou** uma referência real curta, se a rede permitir: barra com porcentagem, conclusão, link repetido avisado, erro de login mostrado.
- [ ] **Step 3:** Documentação: como colar links, o que acontece com login, onde o arquivo fica, autorização.
- [ ] **Step 4:** `npm test`, `npm run typecheck`, `python3 -m unittest discover -s tests` passam.
- [ ] **Step 5:** Commit `"Referências por link na janela e na documentação"`.
