# Controle de qualidade e exportação

Todo vídeo exportado é conferido antes de chegar à pasta `Exportações/`. A conferência
gera um relatório com o que foi aprovado, o que tem problema, a gravidade e como corrigir.
Um vídeo que falha em verificação obrigatória nunca é marcado como aprovado.

- Código: `Pipeline/quality-control/verificador.ts` (Agente de Qualidade),
  `src/nucleo/qualidade.ts` (relatórios e exceções), `src/servicos/qualidade.ts`
  (perfis e presets), `src/nucleo/edicao.ts` (exportação).
- Configuração: `IA/Qualidade/*.json` (destinos) e `IA/Exportacao/*.json` (presets).

## Conferência independente do renderizador

O arquivo é conferido pelo **FFprobe** e pelo **FFmpeg**, que não participam da
composição nem da codificação (feitas pelo Remotion). O FFprobe lê o contêiner e as
faixas; o FFmpeg decodifica o arquivo inteiro e mede imagem e som. Nada do que o
renderizador informa sobre o próprio resultado é aceito como prova.

A conferência acontece em dois momentos:

| Momento | O que confere | Efeito |
|---|---|---|
| Antes do render | A timeline: arquivos, textos, legendas, áreas seguras, trilha, destino | Falha obrigatória impede o início da exportação |
| Depois do render | O arquivo gerado, mais a timeline de novo | Falha obrigatória impede a entrada em `Exportações/` |

## Verificações

Gravidade padrão entre parênteses. `[destino]` indica que a gravidade ou o limite vem do
perfil de qualidade. `(estimativa)` indica verificação marcada como `estimado` no relatório.

### Técnicas

| Verificação | O que confere |
|---|---|
| Arquivos da timeline (obrigatória) | Todo arquivo usado existe no disco |
| Conteúdo (obrigatória) | A timeline tem pelo menos um clipe e duração maior que zero |
| Integridade (obrigatória) | O arquivo abre, tem faixa de vídeo e decodifica sem erros |
| Erros de render (recomendação) | O render precisou de segunda tentativa |
| Codec de vídeo (obrigatória) | H.264 |
| Codec de áudio (obrigatória) | AAC |
| Resolução (obrigatória) | Igual à pedida (timeline ou preset) |
| Taxa de quadros (obrigatória) | Igual à pedida |
| Duração (obrigatória) | Igual à da timeline, com tolerância |
| Compatibilidade (obrigatória) | Contêiner MP4, cor `yuv420p`, largura e altura pares |
| Compatibilidade na web (recomendação) | Taxa de amostragem usual e índice no início do arquivo |
| Quadros pretos inesperados (importante; obrigatória se passam de metade do vídeo) | Tela preta fora do fade final e de cartões escuros |

### Visuais

| Verificação | O que confere |
|---|---|
| Legibilidade dos textos `[destino]` | Tamanho mínimo da letra e tempo na tela suficiente para ler |
| Textos dentro do quadro (importante, estimativa) | O texto cabe na largura útil |
| Legendas (importante) | Tamanho mínimo, quantidade de caracteres e ritmo de leitura |
| Áreas seguras `[destino]` | Margens da timeline iguais ou maiores que as do destino |
| Enquadramento (recomendação) | Ampliação e recorte excessivos do material |
| Transições (recomendação) | Transição cabe na duração do clipe |
| Efeitos (recomendação) | Intensidade dentro de limites razoáveis; barras de cinema em vídeo vertical |
| Cortes inesperados (recomendação, estimativa) | Mudança brusca de imagem fora das trocas de clipe |
| Continuidade visual (recomendação, estimativa) | Salto forte de claridade entre clipes vizinhos |
| Contraste dos textos (importante, estimativa) | Texto sem caixa de fundo sobre imagem de claridade parecida |

### Áudio

| Verificação | O que confere |
|---|---|
| Trilha (importante) | A trilha existe no disco e cobre o vídeo inteiro |
| Presença de áudio (obrigatória) | Há faixa de áudio quando a timeline tem som |
| Áudio audível (importante) | A faixa não está em silêncio do início ao fim |
| Sincronia (importante; obrigatória acima de 0,5 s) | Áudio e vídeo começam juntos e têm a mesma duração |
| Volume (recomendação) | Volume percebido (LUFS) perto do alvo do destino |
| Picos (importante) | Pico real abaixo do limite do destino |
| Distorção (importante) | Amostras no volume máximo |
| Cortes de áudio (recomendação) | Silêncio no meio do vídeo |
| Diferenças de volume (recomendação) | Variação excessiva entre trechos |

### Do destino

| Verificação | O que confere |
|---|---|
| Proporção `[destino]` | Orientação pedida pelo destino |
| Duração `[destino]` | Duração máxima do destino |
| Ritmo (recomendação) | Planos mais longos que o limite do destino |
| Abertura (recomendação; importante se começa em tela preta) | Imagem e movimento nos primeiros segundos |
| Chamada para ação (importante se o plano previa; recomendação se o destino costuma ter) | Presença do CTA na timeline |

O CTA nunca é inventado: a verificação só aponta a ausência.

## Perfis de qualidade por destino

Regras de redes sociais não valem para todos os vídeos. Cada destino tem um arquivo em
`IA/Qualidade/`; o que o destino não avalia aparece no relatório como "não se aplica".

| Perfil | Proporção | Duração máxima | Letra mínima | Área segura (topo / base / lados) | Abertura | Plano mais longo | CTA |
|---|---|---|---|---|---|---|---|
| `redes-sociais` | Vertical (importante) | 90 s (importante) | 3,2% | 10% / 20% / 6% (importante) | 3 s | 6 s | Recomendado |
| `publicidade` | Qualquer | 60 s | 3% | 6% / 10% / 5% (importante) | 3 s | 5 s | Recomendado |
| `youtube` | Horizontal | — | 2,6% | 5% / 8% / 4% | 5 s | 15 s | Não avalia |
| `documentario` | Qualquer | — | 2,4% | 5% / 8% / 4% | Não avalia | Não avalia | Não avalia |
| `institucional` | Horizontal | — | 2,6% | 5% / 8% / 4% | Não avalia | Não avalia | Não avalia |
| `geral` | Qualquer | — | 2,4% | 4% / 6% / 4% | Não avalia | Não avalia | Não avalia |

Alvo de volume: −14 LUFS (−16 em documentário e institucional); pico máximo de −1 dBFS.

**Escolha do perfil**, nesta ordem: o pedido na exportação (`--destino`); a plataforma
informada no briefing do plano; o perfil de mesmo nome do projeto; por fim, o formato —
vertical é tratado como rede social, o restante como geral.

**Personalização.** Um arquivo JSON em `Dados/qualidade/` com o mesmo `id` substitui o
perfil que acompanha o programa; com `id` novo, cria um destino. O mesmo vale para presets
em `Dados/presets/`. Essas pastas ficam fora do Git e sobrevivem a atualizações.

A montagem já aplica à timeline as margens do destino (`areaSegura`). Elas podem ser
mudadas pela operação `apresentacao`.

## Situação final e exceções

| Situação | Quando |
|---|---|
| `aprovado` | Nenhum problema |
| `aprovado-com-ressalvas` | Só recomendações, ou problemas importantes já aceitos |
| `pendente` | Há problema importante ainda sem decisão do usuário |
| `reprovado` | Há falha em verificação obrigatória |

- Falha **obrigatória** não pode ser aceita: precisa ser corrigida.
- Problema **importante** pode ser aceito pelo usuário, um a um, com justificativa
  (`aceitar`). A exceção fica gravada no relatório, com data, e aparece no arquivo do
  relatório e no histórico da exportação.
- **Recomendação** não bloqueia nada.

## Exportação

| | Prévia | Final |
|---|---|---|
| Resolução | Um terço | A da timeline ou a do preset |
| Formato | MP4, H.264 + AAC | MP4, H.264 + AAC |
| Conferência | Básica (integridade e formato) | Controle de qualidade completo |
| Destino | `Dados/projetos/<projeto>/previas/` | `Exportações/<projeto>/` |

**Presets** (`IA/Exportacao/`): `padrao`, `alta-qualidade`, `vertical-1080`,
`vertical-720`, `horizontal-1080`, `horizontal-720`, `quadrado-1080`. Um preset define
resolução, taxa de quadros, qualidade (CRF), velocidade de codificação e taxa de bits do
áudio; campos vazios herdam da timeline. Preset com proporção diferente da timeline é
recusado: a exportação não distorce nem recorta por conta própria.

**Organização e versões.**

```
Exportações/<projeto>/<projeto> v<versão> [<preset>] <AAAAMMDD-HHMMSS>.mp4
Exportações/<projeto>/relatorios/<mesmo nome>.md
```

- O nome traz a versão da timeline; o histórico (`exportacoes`) guarda versão, preset,
  estado, tamanho e resultado da conferência.
- **Sem sobrescrita:** se o nome já existe, o arquivo novo recebe ` (2)`, ` (3)`...
- **Repetir** (`repetir`) refaz uma exportação com a mesma versão e o mesmo preset, em
  arquivo novo.
- **Cancelamento seguro:** o render grava em temporário, o arquivo é conferido em
  `Dados/projetos/<projeto>/em-conferencia/` e só então é movido. Cancelar ou falhar não
  deixa nada em `Exportações/`.
- **Reprovado:** o arquivo vai para `Dados/projetos/<projeto>/reprovados/`, com o
  relatório ao lado, e a tarefa fica como `falhou`.

## Comandos

| Comando | Função |
|---|---|
| `npm run app -- qualidade <projeto> [--destino perfil]` | Confere a timeline, sem renderizar |
| `npm run app -- presets` | Lista presets e destinos |
| `npm run app -- exportar <projeto> [--preset id] [--destino perfil]` | Exporta, confere e mostra o relatório |
| `npm run app -- relatorio <exportação>` | Mostra o relatório de uma exportação |
| `npm run app -- aceitar <relatório> <verificação> "justificativa"` | Aceita um problema não crítico |
| `npm run app -- repetir <exportação>` | Repete uma exportação |

`exportar` termina com código 1 quando a exportação não é concluída.

## Limites desta etapa

- Legibilidade, enquadramento e textos fora do quadro são calculados pela timeline e por
  amostras de quadro, não por leitura da imagem final (OCR). Por isso várias verificações
  visuais são estimativas, e nenhuma estimativa é obrigatória.
- O contraste dos textos não considera a sombra do texto.
- Sincronia é conferida pelo início e pela duração das faixas, não pela fala (labial).
- Limites calibrados com vídeos sintéticos; faltam vídeos reais.
- Telas de relatório e de exceções dependem da interface gráfica.
