# Análise de vídeos de referência

O módulo assiste tecnicamente a um vídeo de referência e transforma **como ele foi
produzido** em conhecimento reutilizável: medições, regras de edição, perfil de estilo e
aprendizados na memória. Funciona com qualquer vídeo e sem nenhum provedor de IA; com
provedores disponíveis, acrescenta a leitura que só um modelo consegue fazer.

## Como usar

**Por link (YouTube, TikTok, Instagram e outros sites):** em **Referências** (ou na aba de
material do projeto), cole um ou mais links, um por linha, e clique em **Baixar**. Cada link
vira uma tarefa com porcentagem; o vídeo vai para `Referências/` (ou `Referências/<segmento>/`)
em até 1080p e é registrado com o link de origem, o título, o autor e a data. O mesmo vídeo
colado em outra forma (`youtu.be/…`, `/shorts/…`, com `?si=` ou `?igsh=`) não é baixado de
novo. Listas e perfis inteiros são recusados. A autorização registrada é "Baixado de <site>
em <data> para análise como referência (ensina princípio, não cópia)" e pode ser editada.
Pela linha de comando:

```bash
npm run app -- referencias baixar "https://youtu.be/ID" --perfil fivem
```

O programa não entra em nenhuma conta. Se o site exigir login (o Instagram quase sempre
exige), a tarefa explica e sugere salvar o vídeo pelo celular ou navegador e arrastá-lo.

**Por arquivo:**

1. Coloque os vídeos na pasta `Referências/`. Um vídeo dentro de uma subpasta com o nome
   de um perfil (por exemplo `Referências/fivem/`) é associado a esse perfil.
2. Registre e analise:

```bash
npm run app -- referencias importar
```

```bash
npm run app -- referencias analisar todas
```

`npm run app -- referencias listar` mostra as referências e quais já foram analisadas.
No código: `app.referencias.importar(arquivo, { perfil })`, `app.referencias.importarPasta()`
e `await app.referencias.analisar(id)`.

Os arquivos de vídeo ficam onde estão: nada é copiado nem alterado.

## O que é analisado

Cada item do relatório declara a sua **base**:

| Base | Significado |
|---|---|
| observado | Medido diretamente no sinal de vídeo ou de áudio |
| estimado | Interpretação por heurística ou por modelo de IA |
| não avaliado | Exigiria um recurso indisponível (o relatório diz qual) |
| não se aplica | Não faz sentido para este tipo de vídeo |

### Imagem

| Item | Como é obtido | Base |
|---|---|---|
| Sequência de cenas, cortes, duração dos planos, ritmo | Diferença entre quadros consecutivos; corte = salto isolado | observado |
| Transições (corte seco, gradual, fade por preto) | Na transição gradual, o quadro do meio é a mistura dos vizinhos | observado |
| Cor (saturação, temperatura, cores dominantes) e iluminação (brilho, contraste) | Estatística dos pixels | observado |
| Composição: barras de cinema e área útil | Faixas escuras fixas em cima e embaixo | observado |
| Movimentos de câmera e zoom | Deslocamento e escala que melhor alinham quadros a 0,5 s de distância | estimado |
| Enquadramentos, efeitos, tipografia, legendas na imagem, animações | Modelo visual sobre os quadros-chave | estimado, ou não avaliado sem modelo |

### Áudio

| Item | Como é obtido | Base |
|---|---|---|
| Volume, silêncios, mudanças de intensidade | Envelope do sinal em janelas de 20 ms | observado |
| Batidas e andamento | Subidas bruscas de volume e sua repetição | observado |
| Sincronia entre áudio e imagem | Cortes a até 130 ms de um ataque sonoro, comparados com o acaso | observado |
| Pontos de corte musical | Ataques sonoros mais fortes | estimado |
| Trilha sonora | Presença de pulso regular | estimado |
| Diálogos e narração (texto falado) | Whisper local, com filtro de voz | estimado |
| Efeitos sonoros; distinção entre diálogo e narração | Exigem modelo | não avaliado |

### Narrativa

| Item | Sem modelo de linguagem | Com modelo de linguagem |
|---|---|---|
| Gancho inicial | Compara os 3 primeiros segundos com o restante (ritmo, volume, fala) | Leitura do modelo |
| Progressão | Cortes por minuto em cada terço do vídeo | Leitura do modelo |
| Destaques | Aumentos bruscos de volume | — |
| Clímax | Janela de 5 s com mais cortes e maior volume | Leitura do modelo |
| Encerramento | Fade de imagem e queda de volume no final | Leitura do modelo |
| CTA | Palavras de chamada para ação ditas no trecho final | Leitura do modelo |
| Desenvolvimento, suspense, humor, emoção | Não avaliado | Leitura do modelo |

**Estrutura de redes sociais não é forçada.** Cada perfil define a estrutura esperada:
`curta` (FiveM, RedM, redes sociais, publicidade) espera gancho e CTA; `livre`
(documentário, institucional, YouTube) não espera, e esses itens saem como "não se aplica"
a menos que sejam de fato encontrados; `automatica` (geral) decide pela duração (até 90 s)
e pela orientação vertical.

### Especializações

Os perfis FiveM e RedM definem tipos de conteúdo — trailer, cena cinematográfica,
gameplay, demonstração de funcionalidade e divulgação de servidor — reconhecidos por
sinais medidos (ritmo, música, sincronia, barras de cinema, fala) e por palavras ditas no
vídeo. O resultado é sempre "estimado". Os tipos ficam no JSON do perfil
(`analise.tiposDeConteudo`), não no código; perfis sem tipos simplesmente não classificam.

## Amostragem

O vídeo é decodificado uma única vez, reduzido a 64×36 pixels e a no máximo 8 quadros por
segundo (menos em vídeos longos, com teto de 6000 quadros). O áudio é lido em mono a
8000 Hz. Para o modelo visual vão apenas até 8 quadros-chave — o instante central de
planos espalhados pelo vídeo —, extraídos só quando existe um modelo para recebê-los.

Um vídeo de 12 s é medido em cerca de 0,15 s neste servidor; a transcrição é a parte lenta.

## O que é gerado

| Saída | Onde |
|---|---|
| Relatório JSON | `Dados/analises/<id>/relatorio.json` e tabela `analises` (tipo `referencia`) |
| Relatório Markdown | `Dados/analises/<id>/relatorio.md` |
| Perfil de estilo (uma faixa por aspecto) | No relatório e na tabela `analises` (tipo `perfil-de-estilo`) |
| Características técnicas | Seção `tecnico` do relatório |
| Regras de edição, cada uma com exemplo de aplicação e confiança | Seção `regras` e tabela `aprendizados` |
| Quadros-chave (só com modelo visual) | `Dados/analises/<id>/quadros/` |
| Modelos usados | Seção `modelosUsados` e tabela `usos_ia` |

O formato completo do relatório está em `src/dominio/analise.ts`.

## Princípios, não cópia

As regras são gravadas em **faixas qualitativas** — "ritmo rápido", "planos de duração
média", "cortes na batida" — e não nos números exatos da referência. Assim, duas
referências de estilo parecido confirmam a mesma regra, e o que vai para a memória é um
princípio aplicável a outro material.

Na memória, cada regra entra como aprendizado do perfil da referência (ou do escopo geral,
se ela não tiver perfil), com a referência registrada como evidência:

- **Uma referência sozinha só gera candidatos.** Nada passa a ser aplicado automaticamente.
- A regra passa a valer quando uma segunda fonte distinta a confirma (três, no escopo geral).
- Analisar de novo a mesma referência substitui o que ela havia ensinado, sem contar em dobro.
- Uma regra sugerida por modelo de linguagem nunca substitui uma regra medida sobre o mesmo assunto.

## Provedores de IA (opcionais)

| Capacidade | Usada para | Sem ela |
|---|---|---|
| `visao` | Enquadramentos, efeitos, tipografia, legendas na imagem, animações | Itens saem como "não avaliado" |
| `texto` | Desenvolvimento, suspense, humor, emoção; regras adicionais | Itens saem como "não avaliado" |
| Whisper local | Transcrição da fala | Fala sai como "não avaliada" |

Os provedores são os da camada descrita em [ARQUITETURA.md](ARQUITETURA.md), configurados
em `ia.provedores`; provedores externos só são usados com `ia.permitirExternos` ligado. O
modelo do Whisper é escolhido em `transcricao.modelo` (padrão `small`) e vai para a GPU
apenas se couber na VRAM livre. Uma resposta inválida de um modelo não interrompe a
análise: vira uma limitação no relatório.

## Limites desta etapa

- Download por link sem login: Instagram e parte do TikTok recusam. Os sites mudam com
  frequência; quando um deixar de funcionar, a atualização do yt-dlp (pela versão nova do
  programa) costuma resolver.

- Sem modelo visual, tudo o que depende de "ver" o conteúdo fica sem avaliação.
- A detecção de movimento de câmera é uma estimativa em baixa resolução: distingue
  estático, panorâmica e zoom, mas não câmera na mão nem movimentos combinados.
- Dissoluções com menos de 0,3 s são contadas como corte seco.
- Volume é medido em dBFS, não em LUFS.
- O andamento pode ser detectado no dobro ou na metade do valor real.
- Referências registradas só por endereço (sem arquivo local) não são analisadas; o
  download autorizado pelo yt-dlp ainda não está ligado à aplicação.
- Testado com vídeos sintéticos de resposta conhecida, não com material real.
