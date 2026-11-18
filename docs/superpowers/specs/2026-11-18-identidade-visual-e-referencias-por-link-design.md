# Identidade visual da marca e referências por link — desenho

Data: 18/11/2026. Decidido em conversa com o usuário; o que foi escolha de quem escreve está
marcado como **(proposta)**.

## Intenção

Duas partes independentes, feitas nesta ordem:

1. **Referência por link.** Colar um link do YouTube, TikTok ou Instagram e o programa baixar o
   vídeo e tratá-lo como as referências de hoje, sem o usuário ter de salvar o arquivo à mão.
2. **Identidade visual da marca.** Uma categoria própria, separada das referências de vídeo,
   para o material de uma marca (manual em PDF, GIFs, logos, fontes). O objetivo, nas palavras
   do usuário: **aplicar nos vídeos o logo, as cores e as fontes da marca.**

## Objetivos

- Colar um ou vários links e obter referências baixadas, com porcentagem, prontas para analisar.
- Cadastrar marcas a partir do **manual em PDF**: o programa lê o PDF e **sugere** logo, cores e
  fontes; o usuário confirma ou corrige. Nada é aplicado sem confirmação.
- Fontes: quando o manual nomeia uma fonte que existe no **Google Fonts**, o programa oferece
  baixá-la (só com confirmação); quando não existe, pede o arquivo.
- Cada projeto escolhe uma marca (ou nenhuma); a montagem aplica logo, cores e fontes dela e
  registra a origem de cada escolha.

## Fora do escopo

- Login em sites (Instagram, TikTok): decidido **tentar sem login**; se o site exigir, a mensagem
  explica e sugere salvar o vídeo pelo celular ou navegador e arrastá-lo para o programa. Sem
  cookies, sem `cookies.txt`, sem leitura do navegador.
- Baixar playlists ou perfis inteiros.
- Reaproveitar os arquivos de fonte embutidos no PDF (vêm recortados e com licença incerta).
- Gerar peças gráficas novas da marca (vinhetas, motion de logo) além do que está abaixo.

## Anti-objetivos (falha mesmo funcionando)

- Aplicar uma cor, fonte ou logo que o usuário não confirmou.
- Mostrar como "observado" algo que foi adivinhado: cor medida em imagem ou logo escolhido por
  heurística/IA é sempre `estimado`; só o código de cor escrito no texto do manual é `observado`
  (com página de origem).
- Baixar qualquer coisa (fonte, vídeo) sem pedido do usuário.
- Alterar o PDF, o logo ou qualquer arquivo original do usuário.
- Deixar o vídeo ilegível: legenda com cor de marca sem contraste suficiente sobre o fundo.

## Restrições (do projeto, valem aqui)

- Camadas: interface → núcleo → serviços → infra; ferramentas que leem/escrevem mídia ficam em
  `Pipeline/`; a janela só mostra e pede; SQL de esquema só em `src/infra/banco.ts`, mudança é
  **migração nova** ao fim de `MIGRACOES`.
- Funciona sem IA. A IA local é ajuda opcional (escolha do logo), e o que ela diz é `estimado`.
- Todo trabalho demorado mostra etapa e porcentagem (`Tarefas`, `barra()`/`atualizarBarra()`).
- Dependência nova de produção só com justificativa em `docs/ARQUITETURA.md`.
- O `.exe` não tem Node.js instalado; Python vem do ambiente (`Caminhos.ambiente`), com pacotes
  instalados pela preparação a partir de `requirements.txt`.
- Um só motor de composição (Remotion). Efeito precisa de motivo e registra a origem.

## Abordagens consideradas (para ler o PDF)

| Abordagem | Troca | Decisão |
|---|---|---|
| **Python com pypdfium2 + pypdf**, script em `Pipeline/`, como o Whisper | Texto, imagens embutidas, nomes de fontes e páginas renderizadas como imagem; sem internet e sem IA; +2 pacotes pip (~10 MB), licenças Apache-2.0/BSD | **Escolhida pelo usuário** |
| Node com pdf.js | Texto e fontes bons; páginas como imagem exigem biblioteca nativa ou o navegador de render; extrair imagens embutidas é trabalhoso; dependência nova no programa principal | Descartada |
| Só IA local lendo páginas como imagem | Exige IA (3 GB); tudo `estimado`, inclusive códigos escritos; contraria "funciona sem IA" | Descartada (fica como ajuda opcional na escolha do logo) |

---

## Parte 1 — Referência por link

### Comportamento

- Na tela **Referências** e na aba de material do projeto: campo para colar um ou mais links
  (um por linha) e botão "Baixar". Cada link vira uma **tarefa** com porcentagem (a do próprio
  yt-dlp, lida da saída).
- Ao terminar: o vídeo fica em `Referências/` (ou `Referências/<perfil>/` se um perfil foi
  escolhido), é registrado como referência com `origemUrl`, título, autor, data e site, e é
  vinculado ao projeto quando o pedido veio de um projeto. A análise não começa sozinha
  **(proposta)**: o usuário pede, como hoje.
- **Link repetido:** se já existe referência com o mesmo `origemUrl` (comparado depois de
  normalizar: sem parâmetros de rastreio, `youtu.be` = `youtube.com/watch`), avisa e não baixa
  **(proposta)**.
- **Autorização** (campo obrigatório de `Referencia`): preenchida com "Baixado de <site> em <data>
  para análise como referência (ensina princípio, não cópia)". Não bloqueia o download
  **(proposta)**; o usuário pode editar o texto depois, como hoje.
- **Formato:** até 1080p, MP4 com áudio, sem playlist (o que `config/yt-dlp.conf` já define).
- **Erros em linguagem simples:** site exigiu login ("O Instagram só deixa baixar esse vídeo
  com login. Salve o vídeo pelo celular ou pelo navegador e arraste o arquivo para cá."), vídeo
  privado/removido, link não reconhecido, sem internet, yt-dlp ausente (preparação incompleta).
- **YouTube no `.exe`:** o yt-dlp precisa de um motor de JavaScript. Usar o próprio executável
  do aplicativo como Node (`--js-runtimes node:<execPath>`, com `ELECTRON_RUN_AS_NODE=1` já no
  ambiente do servidor). Em desenvolvimento, `process.execPath` já é o Node. A confirmar no
  fluxo de lançamento (teste de fumaça baixa um vídeo curto? ver "Deixado ao construtor").

### Onde fica

- `Pipeline/ingestion/links.ts`: executa o yt-dlp do ambiente (`pythonDoAmbiente` → `yt-dlp`
  do mesmo venv), lê o andamento (`--newline --progress-template`), devolve o arquivo e os
  metadados (`--print-json` / `--write-info-json`). Classifica erros conhecidos.
- `src/nucleo/referencias.ts`: `baixarDeLink(url, { perfil?, projetoId? }, aoAvancar)` →
  `Referencia`; checa repetição; registra atividade.
- `src/interface/rotas.ts`: `POST /api/referencias/links` (lista de links) cria tarefas.
- CLI: `referencias baixar <link>` com `progresso()`.

---

## Parte 2 — Identidade visual da marca

### O que é uma marca

| Campo | Conteúdo |
|---|---|
| nome | Texto |
| logo | Arquivo (PNG, SVG, GIF ou imagem tirada do PDF), copiado para a pasta da marca |
| logoClaro | Variante opcional para fundos escuros **(proposta)** |
| cores | Lista ordenada com papel: `primaria`, `secundaria`, `destaque`, `texto`, `fundo` (papéis vazios permitidos); cada cor com `hex`, `base` (`observado` ou `estimado`), `fonte` (ex.: "manual, página 4") |
| fontes | `titulos` e `texto`: nome, arquivo(s) (TTF/OTF/WOFF2) e origem (`google-fonts`, `enviada`) |
| materiais | Arquivos de consulta (PDFs, GIFs, outros), copiados, nunca alterados |
| criadaEm, atualizadaEm | Datas |

Armazenamento: tabelas novas por **migração nova** (`marcas`, `materiais_da_marca`); arquivos em
`<dados>/marcas/<id>/` (cópias; originais intocados). Entra nas cópias de segurança como o resto
do banco; os arquivos da pasta da marca também **(proposta: incluir `marcas/` na cópia)**.

Projeto: `ConfiguracaoDoProjeto.marca: string` (id; vazio = sem marca). Escolhida no formulário
do projeto, ao lado de perfil e estilos.

### Leitura do manual (PDF) → sugestões

Script `Pipeline/brand/ler_manual.py` (pypdfium2 + pypdf), chamado como o Whisper, gera um JSON:

1. **Texto por página** e, nele, códigos de cor: `#RRGGBB`/`#RGB`, `RGB r g b`/`R:… G:… B:…`,
   `CMYK c m y k` (convertido para hex, marcado como conversão), menções a Pantone (guardadas
   como texto; sem tabela Pantone → hex). Cada cor encontrada: `base: observado`, página e o
   trecho de texto ao redor (para o papel: "primária", "secundária"... quando o texto disser).
2. **Nomes de fontes**: do texto ("Tipografia: Montserrat", "Fonte principal …") e dos recursos
   de fonte do PDF (`/BaseFont`, sem prefixo de subconjunto `ABCDEF+`). Lista única, com página.
3. **Imagens embutidas** (candidatas a logo): extraídas com tamanho e página; descartar as muito
   pequenas e fotografias grandes de página inteira por heurística **(proposta)**. Ordem por
   heurística: primeiras páginas, transparência, proximidade de texto "logo/logotipo/marca",
   repetição. Com a IA local disponível, ela reordena olhando as candidatas (`estimado`).
4. **Páginas renderizadas** (baixa resolução) para medir **cores dominantes** quando o texto não
   trouxer códigos (`estimado`) e para a IA local, se houver.

Tudo vira uma **tarefa com porcentagem** (página a página). Manual protegido por senha ou
corrompido: mensagem clara e cadastro manual continua disponível.

### Confirmação (tela da marca)

Mostra lado a lado o que foi encontrado e a origem de cada item; o usuário:
- escolhe o logo entre as candidatas ou envia outro;
- confirma/edita cores e atribui papéis (pré-preenchidos quando o texto disser);
- para cada fonte nomeada: se existir no Google Fonts, "Montserrat encontrada no Google Fonts
  (licença OFL). Baixar?"; se não, "Envie o arquivo da fonte" (ou escolhe outra);
- salva. Só então a marca fica "pronta" para projetos.

Cadastro manual (sem PDF) usa a mesma tela, vazia, com sugestão de cores medida no logo enviado.

### Google Fonts

- Busca pelo nome no catálogo público (sem chave): lista de famílias e os arquivos das variantes
  regular e negrito (no mínimo 400 e 700) **(proposta)**. A forma exata de obter o catálogo e os
  arquivos fica com o construtor, desde que: sem chave de API, só HTTPS, só com confirmação, com
  porcentagem, licença registrada (OFL/Apache) e arquivo guardado na pasta da marca.
- Sem internet: a fonte fica pendente e a marca pode ser salva sem ela (o vídeo usa a fonte
  padrão até lá, e a decisão registra isso).

### Aplicação nos vídeos (montagem e render)

Só quando o projeto tem marca **pronta**. Cada aplicação vira uma `Decisao` com origem nova
`"marca"` (ampliar o tipo `Decisao.origem`):

| Elemento | Aplicação **(proposta de posição e tamanho)** |
|---|---|
| Logo | Item de imagem pequeno num canto (superior direito, ~8% da altura, opacidade 85%) durante o vídeo; grande no cartão final. Em GIF, animado |
| Cores | Caixa da legenda (`fundo` com transparência) e texto da legenda; textos na tela (`cor`, `fundo`); cartão final (`corDeFundo`, `corDoTexto`) |
| Fontes | `titulos` em textos na tela e cartão final; `texto` nas legendas |

- **Precedência (proposta):** a marca decide **cor, fonte e logo** (é a identidade). O estilo e a
  memória continuam decidindo **se há caixa na legenda, posição do texto, tamanhos e animações**.
  Ex.: estilo sem caixa → a legenda continua sem caixa, só muda a fonte.
- **Contraste (proposta):** a cor da marca só vai para o texto quando ele tem caixa; a caixa
  usa a cor da marca quase opaca (alfa ≥ 0,85) e o contraste texto × caixa é conferido como se
  fosse opaca (WCAG ≥ 4,5). Não passou: texto branco ou preto, o que tiver mais contraste, com a
  decisão "cor da marca sem contraste suficiente: usado X". Texto sem caixa (sobre o vídeo)
  continua branco com sombra, como hoje; só a fonte muda. Nada de medir quadros.
- **Retrato da marca (proposta):** a montagem **copia** cores, fontes e logo para os itens da
  timeline (e os arquivos para a pasta do projeto); o render nunca consulta a marca atual. Um
  vídeo já montado ou aprovado não muda em silêncio se a marca for editada. Marca trocada ou
  editada depois da montagem: a tela de edição avisa "A marca mudou" e oferece **"Aplicar marca
  atual"**, uma operação nova de `aplicarOperacao` que gera versão nova da timeline trocando só o
  que veio da marca (itens e propriedades marcados com origem `marca`), preservando as edições
  manuais. A marca não faz parte do plano: escolher ou trocar não desaprova o plano.
- **Correções do usuário (proposta):** mover, tirar ou trocar o logo e as cores da marca na
  edição **não** vira aprendizado do perfil (é da marca, não do tipo de vídeo). Posição e
  opacidade do logo são ajustes guardados na própria marca (tela da marca), com os valores
  acima como padrão.
- **Formato:** em vertical, o logo de canto vai para o topo, longe da área das legendas e da
  interface das redes (regras do perfil `redes-sociais`) **(proposta)**.
- **Render:** a timeline passa a carregar as fontes da marca (arquivos copiados para a pasta
  pública do render, como os trechos) e a composição registra `@font-face`; HyperFrames recebe
  as mesmas cores e fontes no cartão, e o cartão desenhado pelo Remotion também.
- Projeto sem marca: tudo como hoje.

### Onde fica

| Peça | Arquivo |
|---|---|
| Tipos | `src/dominio/marca.ts` (Marca, Cor, Fonte, SugestoesDoManual) |
| Esquema | `src/infra/banco.ts` (migração nova) |
| Serviço | `src/servicos/marcas.ts` (CRUD, arquivos na pasta da marca, confirmação) |
| Google Fonts | `src/servicos/fontes.ts` (busca e download com `src/infra/download.ts`) |
| Leitura do PDF | `Pipeline/brand/ler_manual.py` + `Pipeline/brand/manual.ts` (chama o Python) |
| Fluxo | `src/nucleo/marcas.ts` ou em `fluxo.ts` (tarefa "ler manual") |
| Montagem | `Pipeline/editing/montagem.ts` (aplicação + decisões) |
| Render | `Pipeline/rendering/remotion/*`, `motor.ts`, `hyperframes.ts` (fontes e cores) |
| Janela | `src/interface/web/telas/marcas.js` (lista e tela da marca), seletor no formulário do projeto |
| Dependências | `requirements.txt`: `pypdfium2`, `pypdf` (versões fixas); justificativa em ARQUITETURA |

## Decidido pelo usuário

1. Aplicar nos vídeos: logo, cores e fontes.
2. Entrada pela leitura do manual em PDF, com sugestões confirmadas (opção B).
3. Fontes: Google Fonts com confirmação; senão, pedir o arquivo (opção A).
4. Links: tentar sem login e explicar quando bloquear (opção A).
5. Leitura do PDF pelo Python (pypdfium2 + pypdf).

## Deixado ao construtor

- Formato exato do JSON do script do manual e das tabelas novas.
- Heurísticas de logo e de "papel" das cores (dentro do que está acima).
- Como obter o catálogo e os arquivos do Google Fonts (restrições acima).
- Se o teste de fumaça do lançamento passa a baixar um vídeo curto por link (provavelmente não:
  dependeria de site externo no CI; preferir teste com servidor local e yt-dlp apontando para um
  arquivo servido localmente).
- Layout das telas, seguindo `estilo.css` e o padrão das telas existentes.
