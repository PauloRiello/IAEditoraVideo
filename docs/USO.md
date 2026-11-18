# Guia de utilização

Como fazer um vídeo do começo ao fim na IA Editora de Vídeo. Tudo é feito pela janela da
aplicação; nada precisa ser digitado em linha de comando.

## Andamento

Tudo o que leva tempo mostra a porcentagem e o que está sendo feito naquele momento:
análises (vídeo por vídeo, etapa por etapa), transcrição, prévias, exportações, a
instalação da IA local e o seu teste. O andamento aparece no canto inferior esquerdo, no
Painel e na própria tela da tarefa. Se a instalação da IA local cair no meio, ao tentar de
novo ela continua de onde parou.

## Visão geral da janela

| Área | Para que serve |
|---|---|
| **Painel** | Criar e abrir projetos, ver os recentes, o que está sendo processado e o histórico de atividades |
| **Projetos** | Todos os projetos, com busca |
| **Referências** | Vídeos prontos cujo estilo a aplicação observa: enviar ou colar links (YouTube, TikTok, Instagram), analisar e ler os relatórios |
| **Aprendizado** | O que a aplicação aprendeu, perfis de estilo, preferências, histórico e controle da memória |
| **Configurações** | Preferências, transcrição, provedores de IA opcionais, recursos do computador, pastas e cópias de segurança |

No canto inferior esquerdo aparecem o processamento em andamento e o botão **Encerrar**.

## 1. Criar o projeto

No Painel, clique em **Criar projeto** e preencha:

| Campo | O que é |
|---|---|
| Nome | Como o projeto aparece na aplicação e nas pastas |
| Segmento | Edição geral, FiveM, RedM, Marketing e publicidade, Institucional, YouTube, Documentário, Educação ou Redes sociais |
| Nível de intervenção automática | Quanto a aplicação faz sozinha (veja abaixo) |
| Objetivo | O que o vídeo precisa conseguir. É necessário para gerar o plano |
| Público e plataforma | Quem assiste e onde será publicado. A plataforma define os critérios de qualidade |
| Proporção, resolução e FPS | Vertical, horizontal, quadrado ou medidas personalizadas |
| Duração desejada | Em segundos. Vazio: a aplicação decide pelo material |
| Estilos de edição | Gameplay, ação, trailer, humor e outros. Mais de um: combinados |
| Chamada para ação (CTA) | Texto do convite final. Vazio: o vídeo não terá CTA |
| Fatos | Informações verdadeiras que podem aparecer no vídeo |

A aplicação não inventa nada: textos e roteiro só usam os fatos informados e o que está
no próprio material.

**Níveis de intervenção**

| Nível | O que a aplicação faz sozinha |
|---|---|
| Sugestão | Nada: cada passo é pedido por você |
| Assistido (padrão) | Gera o plano ao terminar a análise e monta a timeline quando você aprova o plano |
| Automático | Além disso, gera a prévia logo depois de montar |

Em todos os níveis o plano espera a sua aprovação, e a exportação final é sempre pedida
por você.

## 2. Adicionar o material e analisar

Na aba **Material e análise**:

1. Arraste os vídeos brutos para a área de envio (ou use **Escolher arquivos**). Eles são
   copiados para a pasta do projeto em `Videos Brutos`. Quem preferir pode copiar os
   arquivos direto para essa pasta (**Abrir pasta**) e clicar em **Procurar novos arquivos**.
2. Clique em **Analisar vídeos**. A análise roda em segundo plano: dados técnicos,
   integridade, cenas, movimento, áudio, possíveis erros e, se marcado, a transcrição das
   falas. Você pode continuar usando a aplicação.
3. Clique em um vídeo analisado para ver as cenas, a transcrição, os problemas encontrados
   e o que não pôde ser avaliado.
4. Use **Pesquisa no material** para encontrar falas, cenas e acontecimentos.

**Referências do projeto.** Envie vídeos de referência, cole links de vídeos (cada um é
baixado com porcentagem; sites que exigem login, como o Instagram, podem recusar) ou associe uma referência já
cadastrada, e clique em **Analisar referências**. O relatório mostra ritmo, cortes,
estrutura e as regras de edição observadas. Uma referência sozinha só gera aprendizados
candidatos; eles passam a valer quando outra fonte confirma.

## 3. Plano e roteiro

Na aba **Plano e roteiro**:

- **Gerar plano de edição** monta o plano: trechos escolhidos, ordem, motivo de cada
  escolha, estrutura, áudio, legendas, trilha e CTA.
- **Aprovar plano** libera a edição. **Rejeitar** registra o motivo. **Gerar nova versão**
  refaz o plano com a configuração atual do projeto; as versões ficam no histórico.
- **Escrever roteiro** é opcional. O roteiro vem cena por cena, na ordem do vídeo, com o
  tempo de cada cena. Sem modelo de linguagem, diz o que mostrar e traz as falas e os
  fatos; com a IA local, traz uma ideia central e uma linha de narração por cena,
  conferidas contra os fatos.

## 4. Edição

Na aba **Edição**:

- **Montar timeline** (automático nos níveis Assistido e Automático) cria a timeline a
  partir do plano aprovado. "Por que a aplicação montou assim" mostra a origem de cada escolha.
- **Gerar prévia** renderiza o vídeo em resolução reduzida para assistir ali mesmo.
- Clique em um item da timeline para ajustá-lo: duração, início, texto, posição, tamanho,
  cor, caixa de fundo, volume, aproximação, tipo de entrada, ordem, dividir e remover.
- Sem item selecionado, **Ajustes gerais** permite adicionar texto, definir a trilha
  sonora, mudar o estilo das legendas e ligar barras de cinema.
- Cada alteração vira uma versão. **Desfazer** volta à anterior; em **Versões da
  timeline** dá para comparar e restaurar qualquer uma. Os vídeos originais nunca são alterados.

## 5. Exportação

Na aba **Exportação**:

1. Escolha o **preset** (resolução e qualidade) e, se quiser, o **destino** (critérios de
   qualidade). Sem escolher, o destino vem da plataforma do projeto.
2. **Conferir qualidade antes** mostra o que a conferência já sabe sem renderizar.
3. **Exportar vídeo final** gera o MP4 (H.264 e AAC). O arquivo é conferido por
   ferramentas independentes do renderizador e só então entra em `Exportações`.
4. No **Histórico de arquivos exportados**: assistir, ver o relatório de qualidade,
   repetir a exportação e abrir a pasta.

No relatório, um problema **obrigatório** reprova o vídeo e precisa ser corrigido. Um
problema **importante** pode ser aceito por você, com justificativa. **Recomendações** não
bloqueiam nada. Detalhes em [QUALIDADE.md](QUALIDADE.md).

## 6. Avaliação

Na aba **Avaliação**, aprove, peça alterações ou rejeite a edição, dê notas de 1 a 5 por
aspecto e marque trechos para revisão. As notas e as correções que você fez na timeline
ensinam a aplicação; uma rejeição sem aspecto apontado não ensina nada. Depois de
publicar, você pode registrar métricas reais (opcional): elas são um sinal fraco e nunca
criam uma regra sozinhas. Detalhes em [FEEDBACK.md](FEEDBACK.md).

## Aprendizado e memória

Na área **Aprendizado**:

- **O que foi aprendido**: separado em geral, por segmento, por projeto e orientações
  temporárias, com confiança e evidências. Cada item pode ser corrigido, ativado,
  desativado ou excluído.
- **Perfis de estilo**: as preferências em vigor em cada segmento.
- **Preferências**: registre uma regra sua (por exemplo, "nunca usar barras de cinema em
  vídeos verticais"). Ela vale de imediato no contexto escolhido.
- **Histórico e controle**: toda ação sobre aprendizados pode ser desfeita.

A memória fica no banco local do seu computador. Detalhes em [MEMORIA.md](MEMORIA.md).

## IA local (opcional, recomendada)

A **IA local** é um modelo aberto de visão e linguagem que roda no seu computador, sem
internet e sem custo. Com ela, a aplicação passa a interpretar o que antes ficava como
"não avaliado":

- os personagens e elementos das cenas dos vídeos brutos;
- o humor das falas;
- os enquadramentos, a tipografia, as legendas na imagem e as animações das referências;
- o desenvolvimento, o suspense e a emoção das referências;
- e o roteiro, que passa a vir com texto de narração redigido.

Para instalar: **Configurações → IA local → Instalar a IA local**. O modelo recomendado
para o seu computador já vem escolhido. São cerca de 3 GB baixados uma única vez, e cada
arquivo é conferido pela soma de verificação publicada. Depois, use **Testar**: a IA local
responde a uma pergunta e diz a cor de uma imagem de teste. Análises feitas antes da
instalação não mudam sozinhas: use **Analisar tudo de novo**.

| Modelo | Tamanho | Para quem |
|---|---|---|
| Qwen3-VL 8B (o mais inteligente) | 5,4 GB | Placa de vídeo com 6 GB ou mais e 16 GB de memória; roteiros mais bem organizados, porém mais lento |
| Qwen3-VL 4B | 2,7 GB | Placa de vídeo com 4 GB ou mais, ou 16 GB de memória |
| Qwen3-VL 2B | 2,1 GB | Computadores sem placa de vídeo ou com pouca memória |

Como ela funciona:

- Liga sozinha quando uma análise precisa e desliga depois de alguns minutos sem uso,
  devolvendo a memória.
- Usa a placa de vídeo o quanto couber nela e põe o resto no processador; sem memória
  livre na placa, roda só no processador, mais devagar.
- Para trocar de modelo: Configurações → IA local → escolha o modelo → **Instalar este
  modelo**. Depois, escreva o roteiro de novo.
- Nada é enviado para fora do computador.
- Tudo o que ela interpreta fica marcado como **estimativa** nos relatórios, nunca como medição.
- Pode ser desativada sem apagar, ou removida, na mesma tela.

Os modelos são de terceiros (família Qwen3-VL, licença Apache 2.0) e o motor é o
llama.cpp (licença MIT). A aplicação não treina um modelo próprio: ela usa esses modelos
abertos e continua aprendendo com você pela memória e pelo feedback.

## Provedores de IA (opcionais)

A aplicação funciona inteira sem nenhum provedor de IA, e a IA local cobre as
interpretações sem serviço externo. Provedores servem para quem já usa outro modelo. Em **Configurações →
Inteligência artificial** há uma tabela com o que funciona localmente e o que depende de
um modelo de linguagem ou de visão.

- **Procurar modelos locais** encontra Ollama, LM Studio ou llama.cpp rodando no computador.
- **Adicionar provedor** aceita qualquer serviço compatível com a API da OpenAI, local ou externo.
- Provedores externos só são usados se você marcar **Permitir provedores externos**.
- A **chave de API** fica em um arquivo separado, só no seu computador. Ela nunca é
  mostrada de volta, não vai para registros nem para as cópias de segurança.

## Uso pela linha de comando (opcional)

Tudo o que a janela faz também existe em comandos, úteis para automação:

```bash
npm run app
```

A lista de comandos aparece na tela e está no [README](../README.md).
