# Vídeos brutos, plano de edição e roteiro

Esta parte da aplicação transforma os arquivos de `Videos Brutos/` em material
organizado e pesquisável e, a partir dele, propõe um plano de edição para o usuário
revisar e aprovar. Nada é editado nem renderizado aqui.

## Os agentes

Cada agente é um componente da própria aplicação, com uma única responsabilidade. Todos
rodam no computador do usuário e funcionam sem provedor de IA; quando há um disponível,
alguns acrescentam leituras que só um modelo consegue fazer. Não têm relação com agentes
de programação nem com serviços externos.

| Agente | Onde | Responsabilidade |
|---|---|---|
| Arquivos | `Pipeline/ingestion/arquivos.ts` | Dados técnicos, integridade e problemas de cada arquivo |
| Conteúdo | `Pipeline/analysis/conteudo.ts` | Cenas, ação, falas, silêncios, destaques, possíveis erros, miniaturas e índice |
| Planejamento | `Pipeline/editing/planejamento.ts` | Plano de edição a partir do briefing, do material e da memória |
| Roteiro | `Pipeline/editing/roteiro.ts` | Roteiro do plano, usando só fatos verificáveis |
| Coordenador | `src/nucleo/producao.ts` | Aciona os demais e grava tudo na memória persistente |

`npm run app -- agentes` lista os cinco. No código, o Coordenador é `app.producao`.

## Fluxo

```bash
npm run app -- projeto criar "Cidade Alta" fivem
```

```bash
npm run app -- brutos importar <projeto>
```

```bash
npm run app -- brutos analisar <projeto>
```

```bash
npm run app -- pesquisar discord
```

```bash
npm run app -- plano gerar <projeto> "Divulgar a inauguração" --duracao 20 --cta "Entre no nosso Discord" --fato "Inauguração no dia 20"
```

```bash
npm run app -- roteiro <projeto>
```

```bash
npm run app -- plano aprovar <projeto>
```

**Importação.** Se existir `Videos Brutos/<nome do projeto>/`, só essa subpasta é usada;
senão, a pasta inteira. Os arquivos são registrados pelo caminho, nunca copiados nem
alterados. Importar de novo só registra o que for novo.

## Agente de Arquivos

Para cada arquivo: nome e localização, formato do contêiner, resolução, taxa de quadros,
duração, codecs de vídeo e de áudio, canais e taxa de amostragem, tamanho e integridade.

| Integridade | Significado |
|---|---|
| `integro` | Decodificou sem erros |
| `com-erros` | Abre, mas há erros de decodificação |
| `ilegivel` | Vazio, truncado, corrompido ou não é um vídeo |

Vídeos de até 60 s são decodificados inteiros; os maiores, em três amostras de 5 s
(começo, meio e fim) — o relatório diz qual verificação foi feita.

Problemas apontados: sem áudio, áudio mono, resolução abaixo de 720 linhas, menos de 23
quadros por segundo, taxa de quadros variável, taxa de bits baixa para a resolução,
orientação diferente da do projeto e erros de decodificação.

## Agente de Conteúdo

Reaproveita a medição da análise de referências ([REFERENCIAS.md](REFERENCIAS.md)).

| Item | Como é obtido | Sem modelo de IA |
|---|---|---|
| Mudanças de cena | Cortes medidos; planos longos são divididos em trechos de até 8 s | Sim |
| Momentos de ação | Segundos seguidos com muito movimento na imagem | Sim |
| Silêncios | Volume abaixo de −45 dBFS por 0,4 s ou mais | Sim |
| Transcrição de falas | Whisper local | Sim, se o Whisper estiver instalado |
| Trechos relevantes e destaques | Nota de 0 a 1: ação (45%), volume (25%) e presença de fala (30%) | Sim (estimativa) |
| Possíveis erros de gravação | Tela preta, imagem parada, trecho muito escuro, silêncio longo, áudio estourado | Sim |
| Miniaturas | Um quadro por cena, até 24 por arquivo, em `Dados/projetos/<projeto>/miniaturas/` | Sim |
| Personagens e elementos visuais | Modelo visual descreve as miniaturas | Não avaliado |
| Humor | Modelo de linguagem classifica as falas transcritas | Não avaliado |

Imagem parada com alguém falando (apresentação, tela fixa) não é tratada como defeito.

### Pesquisa

A análise alimenta um índice por trecho. A pesquisa aceita palavras ditas, acontecimentos
e características, com ou sem acentos; todas as palavras da consulta precisam aparecer no
trecho. Os trechos mais relevantes vêm primeiro.

| Para encontrar | Exemplo de consulta |
|---|---|
| Uma fala | `discord`, `inauguração` |
| Acontecimentos | `ação`, `silêncio`, `destaque`, `humor` |
| Movimento de câmera | `panoramica`, `zoom-in`, `estatico` |
| Características do arquivo | `vertical`, `1080p`, `60fps`, `webm`, `sem-audio` |
| Problemas | `tela-preta`, `imagem-escura`, `com-erros`, `ilegivel` |
| Elementos visuais (com modelo visual) | `viatura`, `cavalo` |

No código: `app.producao.pesquisar("discord", { projetoId, tipo: "fala" })`.
Pesquisa por assunto, no sentido de significado, depende de um modelo: sem ele, a busca é
por palavras e etiquetas.

## Agente de Planejamento

Recebe o **briefing** — só o objetivo é obrigatório; público, plataforma, duração, CTA e
fatos são opcionais — e devolve um plano com:

objetivo, público, plataforma, formato, duração desejada e planejada, estrutura narrativa,
cenas selecionadas com **arquivo e intervalo de tempo**, ordem, transições, áudio,
legendas, efeitos, trilha sonora e CTA.

Como decide:

- **Duração dos planos:** vem do que a memória aprendeu (ritmo ou duração típica) ou do
  estilo das referências vinculadas ao projeto; sem isso, 2 s em vídeo curto e 4 s nos demais.
- **Seleção:** os trechos mais bem pontuados, sem sobreposição, até preencher a duração.
  Uma fala entra inteira, não cortada no meio. Trechos de tela preta, parados ou escuros
  e arquivos com erros ficam de fora.
- **Ordem:** cronológica. Em vídeo curto de divulgação, o trecho mais forte abre o vídeo
  (gancho) e o segundo mais forte vai para o clímax.
- **Transições, trilha e efeitos:** seguem os aprendizados aplicáveis; sem eles, corte seco.
- **Legendas:** as falas dos trechos escolhidos, já posicionadas na linha do tempo.
- **CTA:** só o texto informado no briefing. Sem ele, o plano avisa e não inventa nenhum.

Cada escolha fica registrada em `decisoes`, com a origem: briefing, aprendizado,
referência, perfil ou padrão. O plano também traz `avisos` — material insuficiente,
arquivos em orientação diferente, arquivos deixados de fora.

O planejamento não usa modelo de IA: é determinístico e explicável.

## Aprovação

| Ação | Chamada | Efeito |
|---|---|---|
| Gerar | `producao.planejar(projeto, briefing)` | Nova versão, em rascunho |
| Alterar | `producao.revisarPlano(projeto, plano, nota, correcoes)` | Nova versão do usuário; a anterior fica intacta |
| Aprovar | `producao.aprovarPlano(projeto)` | Marca a versão atual como aprovada |
| Rejeitar | `producao.rejeitarPlano(projeto, motivo)` | Marca como rejeitada, com o motivo |

- **A edição espera a aprovação.** A renderização só roda se a versão mais recente do
  plano estiver aprovada; qualquer alteração depois disso exige aprovar de novo.
- **Tudo fica na memória:** cada geração, alteração, aprovação, rejeição e roteiro é
  gravado em `decisoes`, e o briefing é guardado no projeto.
- **Correções ensinam:** cada correção informada na revisão vale para o projeto na hora e
  entra como candidata no perfil dele, pelas regras de [MEMORIA.md](MEMORIA.md).
- **Aprovar confirma:** os aprendizados que o plano aprovado aplicou ganham uma evidência.

## Agente de Roteiro

O roteiro só pode usar **fatos**: o que o usuário informou no briefing, o que foi dito nos
vídeos e o que foi medido nas cenas. Cada linha cita os fatos em que se apoia.

O roteiro é escrito **cena por cena, na ordem do vídeo**. Cada trecho do plano vira uma
cena com o tempo em que aparece e o que a análise viu naquele trecho exato: personagens e
elementos, falas transcritas, ritmo e humor. O modelo primeiro escreve a ideia central e
depois uma linha por cena, continuando a anterior; cena que ele pular ou escrever mal fica
com a descrição do que mostrar.

- **Sem modelo de linguagem:** entrega uma estrutura por cena — o que mostrar, as falas
  originais e os fatos do briefing como texto na tela, cada um uma única vez e todos
  presentes, com o CTA no fim. Não há texto de narração redigido, e o roteiro diz isso.
- **Com modelo de linguagem:** o modelo redige em linguagem natural, considerando público,
  plataforma e os ângulos do perfil (em FiveM e RedM: gameplay, humor, imersão, divulgação
  de funcionalidades, eventos e recrutamento). O texto é conferido antes de ser aceito:

| Verificação | O que acontece |
|---|---|
| Linha sem fato de apoio | Descartada |
| Chamada para ação que o usuário não informou | Descartada |
| Linha repetida | Removida |
| Abertura genérica ("fala galera", "neste vídeo...") | Substituída pelo trecho mais forte do material |
| Resposta inválida | Volta a estrutura sem modelo |

A conferência garante que cada linha aponte um fato existente; não consegue provar que o
texto da linha diz exatamente o que o fato diz. O roteiro deve ser lido antes de usar.

## Limites desta etapa

- Nada é renderizado: o plano é a entrada da etapa de edição, ainda não implementada.
- A relevância de um trecho é estimada por movimento, volume e fala; não avalia se a cena
  é boa. Sem modelo visual, a aplicação não sabe o que aparece na imagem.
- Humor, personagens e pesquisa por significado dependem de modelos.
- A trilha sonora é só recomendada (andamento e sincronia); nenhuma música é escolhida.
- Recorte de vídeos horizontais para formato vertical é apontado como aviso, não resolvido.
- Testado com vídeos sintéticos de resposta conhecida e com provedores simulados.
