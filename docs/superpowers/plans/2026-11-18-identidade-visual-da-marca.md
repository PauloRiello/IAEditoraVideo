# Identidade visual da marca — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cadastrar marcas a partir do manual em PDF (sugestões confirmadas pelo usuário) e aplicar logo, cores e fontes da marca nos vídeos do projeto.

**Architecture:** Marcas no banco (migração nova) com arquivos copiados em `<dados>/marcas/<id>/`. O Python (`Pipeline/brand/ler_manual.py`, pypdfium2 + pypdf) só **extrai** texto, imagens, nomes de fontes e páginas do PDF; o TypeScript **interpreta** (códigos de cor, papéis, nomes de fonte, candidatas a logo). Fontes do Google Fonts por `src/servicos/fontes.ts`. A montagem copia a marca para a timeline (retrato) e registra decisões de origem `marca`; o Remotion carrega as fontes por `@font-face`.

**Tech Stack:** pypdfium2 e pypdf (novas, fixadas em `requirements.txt`), Remotion, FFmpeg (GIF → trecho), Node/TypeScript sem compilação.

**Spec:** [docs/superpowers/specs/2026-11-18-identidade-visual-e-referencias-por-link-design.md](../specs/2026-11-18-identidade-visual-e-referencias-por-link-design.md), Parte 2.

## Global Constraints

- Nada aplicado sem confirmação; marca só é usada pela montagem no estado `pronta`.
- `observado` só para código de cor escrito no texto do manual (com página); cor medida, logo escolhido por heurística ou IA → `estimado`.
- Nada baixado sem pedido (fontes só com confirmação explícita); originais nunca alterados (cópias em `<dados>/marcas/<id>/`).
- Mudança de esquema = migração nova ao fim de `MIGRACOES`; SQL só em `src/infra/banco.ts`.
- Funciona sem IA; IA local só reordena candidatas a logo.
- Todo trabalho demorado (ler manual, baixar fonte, aplicar) é tarefa com etapa e fração.
- Precedência: marca decide cor, fonte e logo; estilo e memória decidem caixa da legenda, posição, tamanhos e animações.
- Contraste: cor da marca no texto só com caixa (alfa ≥ 0,85); WCAG ≥ 4,5 calculado como opaco; senão branco ou preto (o maior contraste) e decisão "cor da marca sem contraste suficiente: usado X". Texto sem caixa: branco com sombra, só a fonte muda.
- Retrato: a montagem copia a marca para a timeline; o render nunca consulta a marca atual.
- Logo de canto: superior direito, ~8% da altura, opacidade 85%; em vertical, dentro da área segura do topo. Sem cartão final: encerramento ~2 s com fundo na cor da marca, logo centralizado e fade.
- Correções do logo/cores na edição não viram aprendizado do perfil.
- Dependências novas (pypdfium2, pypdf) justificadas em `docs/ARQUITETURA.md`; sem dependência npm nova (GIF animado vira trecho pelo FFmpeg).

## Review Focus

1. **Manual sem nenhum código de cor escrito** (só imagens): as cores vêm medidas, marcadas `estimado`, e a tela diz "medida nas páginas". (Teste na Tarefa 2.)
2. **PDF protegido por senha, corrompido ou que não é PDF:** tarefa termina com mensagem clara e o cadastro manual continua possível. (Teste na Tarefa 2.)
3. **Marca editada depois de o vídeo ser montado:** o render do vídeo montado não muda; "Aplicar marca atual" troca só o que veio da marca e mantém edições manuais. (Teste na Tarefa 5.)
4. **Fonte da marca ainda pendente** (sem internet ou sem arquivo): a marca pode ficar pronta, o vídeo usa a fonte padrão e a decisão registra isso. (Teste na Tarefa 5.)
5. **Cor primária clara (ex.: amarelo) com texto branco:** a legenda nunca sai ilegível. (Teste na Tarefa 5.)

---

### Task 1: Marca no domínio, no banco e no serviço

**Files:**
- Create: `src/dominio/marca.ts`, `src/servicos/marcas.ts`
- Modify: `src/infra/banco.ts` (migração nova), `src/infra/backup.ts` (`PASTAS_DO_USUARIO` + `"marcas"`), `src/dominio/tipos.ts` (`ConfiguracaoDoProjeto.marca: string`, padrão `""`), `src/nucleo/aplicacao.ts` (`app.marcas`)
- Test: `tests/unidade/marcas.test.ts`

**Interfaces:**
- Produces (em `src/dominio/marca.ts`):
  - `type PapelDaCor = "primaria" | "secundaria" | "destaque" | "texto" | "fundo"`
  - `interface CorDaMarca { hex: string; papel: PapelDaCor | null; base: "observado" | "estimado"; fonte: string }`
  - `interface FonteDaMarca { nome: string; arquivos: string[]; origem: "google-fonts" | "enviada" | "pendente"; licenca: string }`
  - `interface Marca { id: string; nome: string; estado: "rascunho" | "pronta"; logo: string | null; logoClaro: string | null; logoPosicao: { canto: "superior-direito" | "superior-esquerdo" | "inferior-direito" | "inferior-esquerdo"; alturaRelativa: number; opacidade: number }; cores: CorDaMarca[]; fontes: { titulos: FonteDaMarca | null; texto: FonteDaMarca | null }; materiais: { arquivo: string; tipo: string; nome: string }[]; criadaEm: string; atualizadaEm: string }`
  - `ServicoMarcas`: `criar(nome: string): Marca`, `obter(id: string): Marca`, `listar(): Marca[]`, `atualizar(id: string, mudancas: Partial<Pick<Marca, "nome" | "cores" | "fontes" | "logoPosicao">>): Marca`, `guardarArquivo(id: string, origem: string, papel: "logo" | "logoClaro" | "material" | "fonte-titulos" | "fonte-texto"): string` (copia para a pasta da marca, nome único, devolve o caminho copiado), `marcarPronta(id: string): Marca` (exige logo e ao menos uma cor; senão `ErroAplicacao("marca-incompleta", …)`), `remover(id: string): void` (recusa se algum projeto usa: `ErroAplicacao("marca-em-uso", …)`).
- Padrão de `logoPosicao`: `{ canto: "superior-direito", alturaRelativa: 0.08, opacidade: 0.85 }`.

- [ ] **Step 1:** Testes: `"cria, edita e marca como pronta só com logo e cor"`; `"arquivos são copiados, o original não é tocado"` (compara conteúdo e data de modificação do original); `"não remove marca usada por projeto"`; `"a cópia de segurança leva as marcas"`; `"banco antigo migra e projetos antigos ficam sem marca"`.
- [ ] **Step 2:** Falham. **Step 3:** Implementar. **Step 4:** `npm test`, `npm run typecheck`.
- [ ] **Step 5:** Commit `"Marcas: domínio, banco, arquivos e cópia de segurança"`.

### Task 2: Leitura do manual em PDF

**Files:**
- Create: `Pipeline/brand/ler_manual.py`, `Pipeline/brand/manual.ts`, `tests/unidade/apoio/pdf.ts` (gera PDFs mínimos de teste)
- Modify: `requirements.txt` (`pypdfium2==<versão estável fixada>`, `pypdf==<versão estável fixada>`, com comentário do porquê), `docs/ARQUITETURA.md` (justificativa)
- Test: `tests/unidade/manual.test.ts`

**Interfaces:**
- `ler_manual.py <pdf> <pasta_de_saida>` imprime linhas JSON `{"pagina": n, "total": t}` durante o trabalho e, no fim, `{"paginas": [{"numero", "texto"}], "fontes": [{"nome", "pagina"}], "imagens": [{"arquivo", "pagina", "largura", "altura", "transparencia"}], "renderizadas": [{"arquivo", "pagina"}]}`; erro: `{"erro": "senha" | "invalido" | "outro", "mensagem"}` e código 1. Nomes de fonte sem prefixo `ABCDEF+`. Páginas renderizadas em ~800 px de largura, PNG.
- Produces em `Pipeline/brand/manual.ts`:
  - `extrairCores(paginas: { numero: number; texto: string }[]): CorDaMarca[]` — `#RRGGBB`/`#RGB`, `RGB r g b` e `R:… G:… B:…`, `CMYK c m y k` (convertido; `fonte` diz "convertido de CMYK"), papel pelo texto vizinho (até ~60 caracteres antes: primária/principal → `primaria`, secundária → `secundaria`, destaque/apoio → `destaque`); sem repetir hex; `base: "observado"`, `fonte: "manual, página N"`.
  - `extrairNomesDeFontes(paginas, fontesDoPdf): { nome: string; pagina: number; papel: "titulos" | "texto" | null }[]` — texto ("Tipografia", "Fonte", "Família tipográfica" seguido do nome; "títulos"/"texto corrido") + nomes do PDF, sem variações de peso (`Montserrat-Bold` → `Montserrat`), sem fontes de sistema óbvias (Arial, Helvetica, Times, Symbol, ZapfDingbats).
  - `ordenarCandidatasALogo(imagens): ImagemCandidata[]` — descarta < 48 px no menor lado e fotos de página inteira (> 85% da página); ordena por: página menor, transparência, repetição (mesmo tamanho em várias páginas), proporção entre 0,2 e 5.
  - `coresMedidas(arquivosPng: string[]): CorDaMarca[]` — até 5 dominantes (via FFmpeg `palettegen` ou leitura simples), ignorando quase branco/quase preto; `base: "estimado"`, `fonte: "medida nas páginas"`.
  - `lerManual(pdf: string, o: { pasta: string; python: string; aoAvancar: (etapa: string, fracao: number) => void; ia?: (imagens: string[]) => Promise<number[]> }): Promise<SugestoesDoManual>` com `SugestoesDoManual = { cores: CorDaMarca[]; fontes: {nome; pagina; papel}[]; logos: { arquivo: string; pagina: number; base: "estimado" }[]; avisos: string[] }`; sem cor escrita → usa `coresMedidas` e aviso "Nenhum código de cor escrito no manual: cores medidas nas páginas."
- Tarefa (em `src/nucleo/fluxo.ts` ou `src/nucleo/marcas.ts`): `lerManualDaMarca(marcaId, arquivoPdf)` — guarda o PDF como material (Task 1), roda `lerManual` com porcentagem por página, guarda as sugestões na marca (`sugestoes` em JSON no registro da marca) para a tela de confirmação.

- [ ] **Step 1:** Testes (`apoio/pdf.ts` escreve PDFs à mão: texto Helvetica com "Cor primária: #1A2B3C" e "RGB 255 200 0", "Tipografia: Montserrat", uma imagem embutida 200×80 com transparência; outro sem texto de cor; outro cifrado; um arquivo `.pdf` que é texto):
  - Unidade TS (sem Python): `"extrai cores escritas com papel e página"`, `"converte CMYK e marca a conversão"`, `"nomes de fontes sem peso e sem fontes de sistema"`, `"ordena candidatas a logo e descarta fotos de página"`.
  - Com o Python do `.venv` (pular se ausente): `"lê o manual inteiro com porcentagem por página"`; `"manual sem códigos: cores medidas, estimado, com aviso"` (Review Focus 1); `"PDF com senha ou inválido: erro claro"` (Review Focus 2).
- [ ] **Step 2:** Falham. **Step 3:** Implementar; instalar as duas dependências no `.venv` local (`npm run setup`). **Step 4:** `npm test`, `npm run typecheck`.
- [ ] **Step 5:** Commit `"Leitura do manual da marca em PDF com sugestões de logo, cores e fontes"`.

### Task 3: Fontes do Google Fonts

**Files:**
- Create: `src/servicos/fontes.ts`
- Test: `tests/unidade/fontes.test.ts`

**Interfaces:**
- Produces: `procurarNoGoogleFonts(nome: string, o?: { origem?: string; sinal?: AbortSignal }): Promise<{ familia: string; licenca: string } | null>` e `baixarDoGoogleFonts(familia: string, pasta: string, o: { aoAvancar: (etapa: string, fracao: number) => void; origem?: string; sinal?: AbortSignal }): Promise<string[]>` (arquivos 400 e 700, subconjuntos latin e latin-ext, WOFF2, guardados na pasta da marca).
- Escolha de fonte de dados (decisão do plano): família pela API CSS pública `https://fonts.googleapis.com/css2?family=<Nome>:wght@400;700` (sem chave; 400 = família inexistente), arquivos pelos `url(...)` dos blocos `/* latin */` e `/* latin-ext */`; licença registrada como `"Google Fonts (SIL Open Font License ou Apache 2.0)"`. Comparação de nome sem diferença de maiúsculas e espaços.
- Na marca: `ServicoMarcas` ganha `definirFonte(id, papel: "titulos" | "texto", fonte: FonteDaMarca)`; rota `POST /api/marcas/:id/fontes/google` só roda quando a janela pede (confirmação feita na janela).

- [ ] **Step 1:** Testes com servidor local imitando o CSS do Google e os arquivos: `"encontra Montserrat e baixa 400 e 700 latin e latin-ext"`; `"fonte que não existe → null"`; `"sem internet → erro sem-conexao e fonte fica pendente"`.
- [ ] **Step 2:** Falham. **Step 3:** Implementar (com `src/infra/download.ts` quando houver tamanho conhecido; senão `fetch` com progresso por arquivo). **Step 4:** `npm test`.
- [ ] **Step 5:** Commit `"Fontes da marca pelo Google Fonts, só com confirmação"`.

### Task 4: Janela da marca

**Files:**
- Create: `src/interface/web/telas/marcas.js`
- Modify: `src/interface/web/app.js` (menu "Marcas"), `src/interface/web/index.html` (se o menu estiver lá), `src/interface/web/telas/formulario-projeto.js` (seletor de marca, só marcas prontas, "Nenhuma"), `src/interface/rotas.ts` (rotas de marcas: listar, criar, obter, atualizar, enviar arquivo, ler manual → tarefa, sugestões, fontes Google, marcar pronta, remover)
- Test: `tests/unidade/interface.test.ts` (rotas)

**Interfaces:**
- Consumes: Tasks 1–3.
- Tela da marca: enviar manual (PDF) → barra da tarefa → painel de sugestões com origem de cada item ("manual, página 4", "medida nas páginas", "escolhido pela IA local: estimado"); candidatas a logo em grade para escolher (ou enviar outro arquivo); cores com papel editável e seletor de cor; para cada fonte nomeada, "<Nome> encontrada no Google Fonts. Baixar?" ou "Envie o arquivo da fonte"; posição/opacidade do logo; botão "Marca pronta". Materiais listados (abrir pasta).

- [ ] **Step 1:** Testes das rotas: criar, enviar logo, ler manual (tarefa com porcentagem, com o Python falso ou pulando sem `.venv`), confirmar e marcar pronta; `"projeto escolhe marca pronta e não aceita rascunho"`.
- [ ] **Step 2:** Falham. **Step 3:** Implementar rotas e tela. **Step 4:** `npm test`; conferir no navegador de verdade (Playwright): fluxo do manual de teste até "pronta" e seleção no projeto; capturas.
- [ ] **Step 5:** Commit `"Tela de marcas: manual, sugestões, confirmação e escolha no projeto"`.

### Task 5: Aplicação na montagem

**Files:**
- Modify: `src/dominio/timeline.ts` (`ItemBase.origem?: "marca"`; `Timeline.marca?: { id: string; atualizadaEm: string; fontes: { titulos: string | null; texto: string | null }; arquivosDeFonte: string[] }`; `Timeline.legendas` ganha `cor?: string; fundo?: string`; `Operacao` ganha `{ tipo: "aplicar-marca"; marca: RetratoDaMarca }`), `src/dominio/producao.ts` (`Decisao.origem` + `"marca"`), `Pipeline/editing/montagem.ts` (`EntradaDaMontagem.marca?: RetratoDaMarca`), `src/servicos/timeline.ts` (operação), `src/nucleo/edicao.ts` (passa o retrato da marca pronta do projeto; aviso "A marca mudou")
- Create: `Pipeline/editing/marca.ts` (aplicação pura e contraste)
- Test: `tests/unidade/edicao.test.ts`

**Interfaces:**
- Produces: `type RetratoDaMarca = Pick<Marca, "id" | "atualizadaEm" | "logo" | "logoClaro" | "logoPosicao" | "cores" | "fontes">`; `contraste(hexA: string, hexB: string): number` (WCAG); `aplicarMarca(timeline: Timeline, marca: RetratoDaMarca, contexto: { temCartaoFinal: boolean; vertical: boolean; estilo: EstiloDeEdicao }): { timeline: Timeline; decisoes: Decisao[] }` — logo de canto em toda a duração (`origem: "marca"`); cores na caixa (`fundo` = primária com alfa 0,85) e no texto quando há caixa, com a regra de contraste; cartão final com `corDeFundo`/`corDoTexto` da marca e logo grande; sem cartão final → encerramento de 2 s (`ItemCartao` sem título com logo, ou `ItemImagem` sobre fundo da cor primária) com fade; fontes registradas em `timeline.marca`. Pura: não lê arquivos nem banco.
- `"aplicar-marca"` remove os itens com `origem: "marca"` e as propriedades de cor/fonte vindas da marca e aplica de novo; demais itens e edições intocados.

- [ ] **Step 1:** Testes: `"logo de canto, cores e fontes aplicadas com decisões de origem marca"`; `"amarelo com branco: legenda sai legível e a decisão explica"` (Review Focus 5, `contraste("#FFFF00", "#FFFFFF") < 4.5`); `"estilo sem caixa: legenda continua sem caixa, só a fonte muda"`; `"sem cartão final: encerramento de 2 s com o logo"`; `"vertical: logo dentro da área segura do topo"`; `"marca editada: timeline montada não muda; aplicar-marca troca só o da marca e mantém um corte manual"` (Review Focus 3); `"fonte pendente: vídeo com fonte padrão e decisão registrada"` (Review Focus 4); `"projeto sem marca: timeline idêntica à de antes"`.
- [ ] **Step 2:** Falham. **Step 3:** Implementar. **Step 4:** `npm test`, `npm run typecheck`.
- [ ] **Step 5:** Commit `"Marca aplicada na montagem: logo, cores, fontes, contraste e encerramento"`.

### Task 6: Render com a marca

**Files:**
- Modify: `Pipeline/rendering/remotion/Video.tsx` (fontes por `@font-face` a partir de `staticFile`, nas legendas, textos e cartão; cor/fundo da legenda), `Pipeline/rendering/motor.ts` (copia fontes e logo para a pasta pública do render; GIF animado → trecho de vídeo com transparência pelo FFmpeg na preparação), `Pipeline/rendering/hyperframes.ts` (fonte e cores no cartão; o cartão desenhado pelo Remotion também)
- Test: `tests/unidade/edicao.test.ts` (render real curto)

- [ ] **Step 1:** Teste de render real (como os existentes, com vídeo gerado pelo FFmpeg e uma fonte OFL pequena de teste em `tests/unidade/apoio/`): `"render com marca: caixa da legenda na cor da marca e logo no canto"` — extrai um quadro com FFmpeg e confere a cor média de uma região da caixa (±12 por canal) e pixels não pretos na região do logo; `"GIF animado vira trecho e não quebra o render"`.
- [ ] **Step 2:** Falham. **Step 3:** Implementar. **Step 4:** `npm test` (suíte completa), `npm run typecheck`; conferir uma prévia no navegador de verdade.
- [ ] **Step 5:** Commit `"Render com fontes, cores e logo da marca"`.

### Task 7: Documentação

**Files:**
- Create: `docs/MARCAS.md`
- Modify: `README.md`, `docs/USO.md`, `docs/LIMITACOES.md` (Pantone sem conversão, fontes fora do Google Fonts, PDFs só imagem), `docs/ARQUITETURA.md`, `docs/MAPA.md`, `docs/PROGRESSO.md`, `CLAUDE.md` (tabela de pastas: `Pipeline/brand/`, regra "marca: observado só para código escrito")

- [ ] **Step 1:** Escrever; `python3 -m unittest discover -s tests` passa.
- [ ] **Step 2:** Commit `"Documentação da identidade visual da marca"`.
