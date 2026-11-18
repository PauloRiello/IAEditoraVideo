# Feedback e aprendizado contínuo

A aplicação melhora suas escolhas de edição a partir do que o usuário aprova, rejeita,
corrige e informa sobre os resultados. Tudo fica no banco local, com a origem registrada,
e pode ser desfeito. Nada depende de serviço externo.

As regras de base — escopos, evidências, confiança e promoção — estão em
[MEMORIA.md](MEMORIA.md). Este documento trata do que alimenta esse aprendizado.

## Avaliar uma edição

```bash
npm run app -- avaliar <projeto> aprovar "Ficou no tom certo"
```

```bash
npm run app -- avaliar <projeto> alterar "O final está abrupto" --nota ritmo=4 --nota cortes=2 --trecho "4-6:Suavizar a saída"
```

```bash
npm run app -- avaliar <projeto> rejeitar "Não passa a seriedade da empresa"
```

No código: `app.feedback.avaliar(projetoId, { decisao, motivo, notas, trechos, correcoes })`.

| O que o usuário pode fazer | Como |
|---|---|
| Aprovar, rejeitar ou pedir alterações | `decisao`: `aprovada`, `rejeitada` ou `alteracoes-solicitadas` |
| Informar o motivo | `motivo` — obrigatório ao rejeitar ou pedir alterações |
| Avaliar por aspecto | `notas` de 1 a 5 para `roteiro`, `ritmo`, `cortes`, `efeitos`, `audio` e `resultado` |
| Marcar trechos para revisão | `trechos`: início, fim, item da timeline, aspecto e comentário |
| Declarar uma preferência junto | `correcoes`: categoria, assunto, valor e descrição |
| Avaliar uma versão ou exportação específica | `versao` e `exportacaoId` |

A avaliação refere-se a uma versão da timeline (por padrão, a atual). Os trechos marcados
ficam pendentes até serem resolvidos (`app.feedback.resolverTrecho`); `avaliacoes
<projeto>` lista as avaliações e os trechos pendentes.

## Comparar versões

```bash
npm run app -- comparar <projeto> 1 3
```

`app.feedback.compararVersoes(projetoId, de, para)` devolve os itens que entraram, saíram
e mudaram (campo a campo), os indicadores de cada versão e um resumo em frases. Sem
números, compara a versão anterior com a atual.

Indicadores: duração, número de clipes, duração mediana dos planos, cortes por minuto,
fração de transições graduais, clipes com cor e com zoom, barras de cinema,
enquadramento, legendas (quantidade, tamanho, caixa), textos e sua posição, trilha e seu
volume, efeitos sonoros, encerramento e formato do CTA.

## O que cada avaliação ensina

| Situação | Efeito no aprendizado |
|---|---|
| Edição **aprovada** depois de alterações manuais | A diferença entre a versão montada pela IA e a aprovada vira **correção**: vale para o projeto na hora e fica **candidata** no perfil dele |
| Edição aprovada | Os aprendizados em vigor no projeto ganham uma confirmação |
| Nota 4 ou 5 em um aspecto | Confirma os aprendizados em vigor daquele aspecto |
| Nota 1 ou 2 em um aspecto | Contesta os aprendizados em vigor daquele aspecto, mesmo em edição aprovada |
| Nota 3, ou aspecto sem nota em edição não aprovada | Nada |
| Rejeição ou pedido de alteração **sem aspecto apontado** | Fica registrado, mas não ensina nada: não se sabe o que estava errado |
| Preferência declarada em `correcoes` | Vale para o projeto e fica candidata no perfil |

### Correções manuais

As correções são deduzidas comparando indicadores, e só conta o que **muda de faixa**:
encurtar um plano de 2 s para 1,8 s não ensina nada; trocar cortes secos por transições
graduais, sim.

| Assunto | Faixas |
|---|---|
| `duracao-planos/duracao-tipica` | curta, media, longa |
| `ritmo/cadencia-de-cortes` | rapido, moderado, lento |
| `transicoes/tipo-predominante` | corte-seco, misto, gradual |
| `transicoes/encerramento` | corte, fade-preto |
| `cores/saturacao` | baixa, media, alta |
| `zoom/uso` | raro, ocasional, frequente |
| `efeitos-visuais/barras-de-cinema` | sim, nao |
| `enquadramento/modo` | preencher, conter |
| `legendas/uso`, `legendas/tamanho`, `legendas/caixa` | sim/nao; pequena, media, grande; sim/nao |
| `tipografia/posicao-do-texto` | topo, centro, base |
| `trilha-sonora/volume` | baixo, medio, alto |
| `cta/formato` | cartao, texto |

O planejamento e a montagem consultam esses mesmos assuntos. Por isso, quando uma
preferência passa a valer no perfil, os projetos seguintes já nascem com ela — e o plano
e a timeline registram que a escolha veio de um aprendizado.

Estrutura narrativa e estilo de comunicação não são deduzidos da timeline: entram por
preferências declaradas (categorias `narrativa`, `hooks`, `comunicacao`) e pelas notas do
aspecto `roteiro`.

### Uma correção isolada não vira regra

A correção de um projeto fica como candidata no perfil. Ela só passa a valer para outros
projetos quando aparece em um **segundo projeto distinto** do mesmo perfil. Nunca chega
às preferências gerais por esse caminho: essas exigem três fontes distintas ou uma
instrução explícita.

## Contextos

| Contexto | Onde fica | Vale para |
|---|---|---|
| Preferências gerais | escopo `geral` | Todos os projetos |
| Preferências de projeto | escopo `projeto` | Só aquele projeto |
| FiveM, RedM, redes sociais, comerciais (`publicidade`), institucionais e outros perfis | escopo `especializacao`, um por perfil | Projetos daquele perfil |
| Orientações temporárias | escopo `temporaria` | Até expirar |

O que se aprende em um perfil não passa para outro. Um teste confere que uma preferência
de FiveM não altera projetos de RedM, institucionais nem as preferências gerais.

## Ver e controlar o que foi aprendido

```bash
npm run app -- aprendido
```

```bash
npm run app -- aprendido fivem
```

| Ação | Chamada | Linha de comando |
|---|---|---|
| Ver tudo, por contexto | `app.feedback.painel()` | `aprendido [perfil]` |
| Ver o estilo em vigor de um perfil | `app.feedback.perfilAprendido(perfil)` | — |
| Ver de onde veio um aprendizado | `app.aprendizado.evidencias(id)` | — |
| Corrigir, desativar, ativar, excluir | `app.aprendizado.corrigir`, `desativar`, `ativar`, `excluir` | `aprendizado desativar <id>` etc. |
| Desfazer uma dessas ações | `app.aprendizado.desfazerAcao(acao)` | `aprendizado acoes`, `aprendizado desfazer <ação>` |
| Desfazer o que uma avaliação ensinou | `app.feedback.desfazerAvaliacao(id)` | `desfazer-avaliacao <id>` |
| Remover um resultado e o sinal que ele deu | `app.feedback.removerResultado(id)` | — |

**Rastreabilidade.** Cada evidência guarda a origem (correção, feedback, análise ou
instrução), o projeto, a avaliação ou o resultado que a gerou e um texto com a decisão e
o motivo informado.

**Reversibilidade.**
- Cada correção, desativação, ativação ou exclusão feita pelo usuário guarda o estado
  anterior completo, com as evidências. Desfazer devolve o aprendizado exatamente ao que era.
- Desfazer uma avaliação remove as evidências que ela gerou; aprendizados que ficarem sem
  nenhuma evidência somem. Evidências de outras fontes continuam valendo — por exemplo, a
  aprovação de um plano que já aplicava a preferência.
- A avaliação desfeita continua no histórico, marcada como desfeita.

## Métricas de resultado

```bash
npm run app -- resultado <projeto> Instagram --visualizacoes 1200 --retencaoPercentual 48 --entradasNoDiscord 9
```

No código: `app.feedback.registrarResultado(projetoId, { plataforma, metricas, evidenciaDeAtribuicao })`.

Métricas aceitas, todas informadas pelo usuário: visualizações, retenção (%), tempo
assistido, compartilhamentos, comentários, curtidas, cliques, conversões, entradas no
Discord e novos jogadores.

| Regra | Como é garantida |
|---|---|
| Não inventar métricas | A aplicação só guarda o que foi informado; não calcula nem estima nenhuma. Métrica desconhecida, negativa ou retenção acima de 100 é recusada |
| Novos jogadores só com evidência | `novosJogadores` é recusado sem `evidenciaDeAtribuicao` (por exemplo, um código de convite exclusivo do vídeo) |
| Não presumir causalidade | Um resultado só é comparado quando há ao menos **3** resultados anteriores do mesmo perfil e plataforma. Antes disso, a leitura é "insuficiente" e nada é aprendido |
| Números absolutos não julgam a edição | Visualizações, cliques e entradas dependem de alcance e divulgação: ficam registrados, mas não geram sinal. A comparação usa retenção ou, na falta, a taxa de engajamento |
| Sinal adicional, não garantia | Só um resultado 25% acima ou abaixo da mediana gera sinal, com **metade do peso** de uma avaliação do usuário, e apenas sobre aprendizados já em vigor |
| Métricas não criam regras | Um sinal de métrica não conta como fonte distinta: nunca promove um candidato |

Toda leitura traz o texto: a comparação indica correlação, não prova que a edição causou
o resultado, e resultados passados não garantem desempenho futuro.

## Persistência

Avaliações, trechos em revisão, resultados e ações sobre aprendizados ficam em tabelas
próprias do banco (esquema v6) e entram nas cópias de segurança. Sobrevivem a
fechamentos, reinicializações e atualizações, como o restante da memória.

## Limites desta etapa

- Não há interpretação do texto do motivo: ele fica registrado e aparece na origem das
  evidências, mas só notas, correções e decisões geram aprendizado.
- "Aprendizados aplicados" são os que estavam em vigor no projeto no momento da avaliação
  ou do resultado, não uma lista exata do que a montagem usou.
- As correções deduzidas cobrem os assuntos da tabela acima; mudanças fora deles (por
  exemplo, reordenar clipes) aparecem na comparação, mas não viram preferência.
- As métricas são digitadas pelo usuário; não há importação das plataformas.
- Na janela, a avaliação fica na aba Avaliação do projeto e o controle do que foi aprendido
  na área Aprendizado ([USO.md](USO.md)).
