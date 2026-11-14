# Motor de edição e renderização

Transforma um plano de edição aprovado em um vídeo: monta a timeline, permite editá-la,
gera prévias e renderiza o arquivo final. Serve a qualquer tipo de vídeo; FiveM e RedM
entram como estilos, não como limitação.

## Papel de cada ferramenta

Há um único motor de composição. As outras ferramentas só produzem insumos para ele.

| Ferramenta | Papel | Onde |
|---|---|---|
| **Remotion** | Compõe a timeline inteira — clipes, camadas, textos, legendas, transições, efeitos e mixagem de áudio — e codifica o MP4 | `Pipeline/rendering/remotion/`, `motor.ts` |
| **FFmpeg** | Prepara os trechos usados: recorte exato, taxa de quadros constante e redução de tamanho. Lê os originais, nunca os altera | `Pipeline/rendering/motor.ts` |
| **HyperFrames** | Gera cartões animados em HTML/CSS/GSAP (encerramento com a chamada para ação). O cartão vira um trecho de vídeo e entra na timeline como qualquer clipe | `Pipeline/rendering/hyperframes.ts` |
| **FFprobe** | Lê os dados dos originais e confere o arquivo exportado | `Pipeline/analysis/ferramentas.ts` |

Por que preparar trechos com o FFmpeg: o navegador de render não lê todos os formatos
(MPEG-TS, por exemplo) nem lida bem com taxa de quadros variável, e trechos pequenos
tornam o render rápido e previsível. Os trechos ficam em cache e são reaproveitados
entre prévias e exportações.

## Fluxo

```bash
npm run app -- montar <projeto> --estilo divulgacao-comercial
```

```bash
npm run app -- editar <projeto> '{"tipo":"alterar","id":"clipe-1","campos":{"velocidade":0.5}}'
```

```bash
npm run app -- previa <projeto>
```

```bash
npm run app -- exportar <projeto>
```

`timeline`, `desfazer`, `trilha <projeto> <arquivo>`, `exportacoes` e `estilos` completam
os comandos. No código, tudo está em `app.edicao`.

A montagem e o render exigem o plano atual aprovado ([PRODUCAO.md](PRODUCAO.md)).

## Timeline

A timeline é só dado (`src/dominio/timeline.ts`): referencia os arquivos originais pelo
caminho e descreve o que fazer com eles.

| Item | O que guarda |
|---|---|
| `video` | Arquivo, ponto de início no original, duração, velocidade, volume, enquadramento, entrada, saída e efeitos |
| `imagem` | Arquivo, enquadramento, entrada, saída e efeitos |
| `cartao` | Título, subtítulo e cores do cartão animado (HyperFrames) |
| `texto` | Texto, posição, tamanho, cor, caixa de fundo e animação |
| `legenda` | Texto, no estilo de legenda da timeline |
| `audio` | Trilha, efeito sonoro ou narração: arquivo, volume, fades e trechos em que o volume baixa |

Todo item tem camada, início e duração. A camada 0 é a faixa principal, em que os clipes
ficam encostados uns nos outros. Um item pode ser **ancorado** a outro: a legenda de um
clipe o acompanha se ele mudar de lugar e some se ele for removido.

### Operações

Cada operação devolve uma timeline nova; a anterior não é modificada.

| Operação | Efeito |
|---|---|
| `inserir` | Acrescenta vídeo, imagem, texto, legenda, cartão ou áudio |
| `remover` | Retira um item |
| `cortar` | Novo início e/ou fim de um trecho |
| `dividir` | Parte um item em dois |
| `ajustar-duracao` | Muda a duração |
| `reposicionar` | Muda a ordem de um clipe na faixa principal |
| `mover` | Muda o instante de um item livre |
| `mudar-camada` | Põe um item acima ou abaixo de outros |
| `alterar` | Muda campos: velocidade, volume, enquadramento, transição, efeitos, texto |
| `efeito-global` | Liga ou desliga um efeito do vídeo inteiro |
| `formato` | Muda resolução e taxa de quadros |

Depois de cada operação os clipes da faixa principal se reencostam e os itens ancorados
se reposicionam. Operações inválidas (corte fora do trecho, velocidade fora de 0,1 a 8,
resolução ímpar) são recusadas sem criar versão.

**Recursos disponíveis hoje:** transição em corte ou gradual; saída em fade; efeitos
`cor` (saturação, contraste, brilho), `zoom-lento` e `barras-de-cinema`; velocidade;
enquadramento (preencher ou conter, posição e zoom); textos com animação; legendas;
trilha com redução automática de volume durante as falas.

### Edição não destrutiva

- Os arquivos originais são apenas lidos. Um teste confere que não mudam depois do render.
- Cada alteração é salva como uma **nova versão** da timeline, com autor e descrição.
- `restaurar` volta a qualquer versão criando uma versão nova: o histórico nunca é reescrito.

## Montagem inteligente

O Agente de Edição (`Pipeline/editing/montagem.ts`) monta a timeline a partir do plano
aprovado usando: o estilo escolhido, os aprendizados aplicáveis (que já incluem correções
e aprovações anteriores), o estilo das referências vinculadas ao projeto, o formato, o
roteiro e o que a análise mediu em cada cena.

Um recurso só é aplicado quando o contexto pede, e cada escolha fica registrada com a origem:

| Recurso | Quando é aplicado |
|---|---|
| Transição | A que a memória aprendeu; sem aprendizado, a do estilo |
| Correção de cor | Uma só por clipe: a da memória (saturação alta ou baixa) ou, na falta, a do estilo |
| Zoom lento | Só em planos parados de 1,5 s ou mais, e só se o estilo ou a memória pedirem |
| Barras de cinema | Só em formato horizontal; em vertical ou quadrado são recusadas, com o motivo |
| Legendas | Quando os trechos escolhidos têm fala |
| Textos na tela | Os fatos do briefing que o roteiro colocou como texto, cada um uma vez |
| Chamada para ação | Cartão animado ou texto, conforme o estilo; só existe se o briefing informou o texto |
| Trilha | Só se o usuário escolheu um arquivo; baixa de volume durante as falas |
| Taxa de quadros | A dos originais, se todos coincidirem; senão, a do formato do projeto |

No estilo `padrao`, nenhum efeito é aplicado.

## Estilos de edição

Arquivos JSON em `IA/Estilos/` (os do usuário em `Dados/estilos/`). Qualquer perfil pode
usar qualquer estilo; `indicadoPara` é só uma sugestão.

| Estilo | Planos | Transição | Proposta |
|---|---|---|---|
| `padrao` | 2,5 s | corte | Neutro, sem efeitos |
| `gameplay` | 4 s | corte | Imagem sem tratamento, planos longos |
| `acao` | 1,5 s | corte | Cor mais viva, ritmo rápido |
| `humor` | 2,5 s | corte | Legendas grandes, tempo para a piada |
| `trailer` | 1,8 s | corte | Contraste alto, barras de cinema, cartão final |
| `cinematografia` | 5 s | gradual | Zoom lento, barras de cinema, fade final |
| `demonstracao` | 4 s | corte | Sem efeitos, texto explicativo no topo |
| `eventos` | 2 s | corte | Cor viva, cartão final |
| `recrutamento` | 2,5 s | gradual | Cartão final com a chamada |
| `divulgacao-comercial` | 2 s | corte | Cor viva, cartão final |

**Combinação:** `--estilo trailer --estilo cinematografia`. O primeiro define ritmo,
transição, texto e encerramento; os efeitos se somam, um de cada tipo. Onde os estilos
discordam, a montagem avisa qual valor foi usado. O estilo informado no briefing também
orienta a duração dos planos no planejamento.

## Formatos e exportação

- Vertical 9:16, horizontal 16:9 e quadrado 1:1, com resolução e taxa de quadros livres
  (largura e altura pares). O formato inicial vem do projeto: em redes sociais, 1080×1920.
- Exportação padrão: **MP4 com H.264 e AAC**. Presets de resolução, taxa de quadros e
  qualidade estão em [QUALIDADE.md](QUALIDADE.md).
- A taxa de quadros dos originais é mantida na preparação dos trechos; a conversão para a
  taxa de saída acontece uma única vez, na composição.
- Arquivo em orientação diferente da do formato recebe recorte central, ajustável por clipe.

## Prévia e renderização

| | Prévia | Final |
|---|---|---|
| Resolução | Um terço (1080×1920 → 360×640) | Inteira, ou a do preset |
| Codificação | Rápida, qualidade baixa | Qualidade alta |
| Destino | `Dados/projetos/<projeto>/previas/` | `Exportações/<nome do projeto>/` |
| Nome | `previa-v<versão>.mp4` | `<nome> v<versão> [<preset>] <data-hora>.mp4`, nunca sobrescreve |

**Tarefas.** Cada render é uma tarefa com estado (`na-fila`, `renderizando`, `concluida`,
`falhou`, `cancelada`) e progresso. Roda um render por vez, para não disputar CPU,
memória e GPU. O progresso sai pelos eventos `render:progresso` e `render:atualizado`.

**Cancelamento seguro.** `app.edicao.cancelar(id)` (ou Ctrl+C na linha de comando)
interrompe o render. O vídeo é gravado em arquivo temporário e só vai para o destino ao
terminar: cancelar ou falhar nunca deixa arquivo pela metade.

**Recuperação de falhas.**
- Se a primeira tentativa falha, é feita uma segunda em modo conservador: um quadro por
  vez e codificação pela CPU. Isso cobre falta de memória e falha da GPU.
- Se a aplicação fecha durante um render, a tarefa é marcada como falha na abertura
  seguinte, os temporários são apagados e ela pode ser repetida (`app.edicao.repetir`).

**Conferência.** A prévia passa por uma conferência básica: integridade, H.264, AAC,
resolução, taxa de quadros e duração. O vídeo final passa pelo controle de qualidade
completo, antes e depois do render, e só entra em `Exportações/` se nenhuma verificação
obrigatória falhar; o relatório fica em `Exportações/<projeto>/relatorios/`. Verificações,
destinos, exceções e presets estão em [QUALIDADE.md](QUALIDADE.md).

**Histórico.** `exportacoes` lista todas as tarefas do projeto, com arquivo, tamanho,
duração e resultado da conferência.

### Recursos do computador

- **Paralelismo:** metade dos núcleos, limitado pela memória livre (cerca de 1,5 GB por
  quadro em paralelo) e por um teto de 8.
- **GPU:** a codificação por hardware só é pedida se a detecção (`npm run gpu`) confirmou,
  com um teste real, que a placa codifica vídeo. Mesmo assim o Remotion volta para a CPU
  se não der, e a segunda tentativa é sempre pela CPU. Ter uma placa como a RTX 3050 não
  garante aceleração: o desenho dos quadros pelo navegador continua dependendo da CPU.
- A prévia e a preparação dos trechos usam sempre a CPU.

## Limites desta etapa

- Sem interface gráfica: a timeline é editada por operações, em código ou em JSON pela
  linha de comando. A prévia é um arquivo, não uma reprodução ao vivo.
- Poucos efeitos e uma única transição além do corte, de propósito.
- O HyperFrames é usado só no cartão final; cartões transparentes sobre o vídeo e blocos
  do catálogo dele ficam para depois.
- Legendas não são quebradas em frases curtas nem animadas palavra a palavra.
- A sincronia dos cortes com as batidas da trilha não é aplicada: a trilha entra inteira.
- A codificação por GPU (NVENC) e a execução em Windows não foram testadas neste servidor.
- O primeiro render de cada instalação leva cerca de 40 s a mais para empacotar a composição.
- Validado com vídeos sintéticos.
