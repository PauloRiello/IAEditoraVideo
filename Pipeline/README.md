# Pipeline — processamento audiovisual

Cada pasta guarda a implementação de uma etapa. Só aqui o código executa FFmpeg,
FFprobe, Whisper, Remotion, HyperFrames e yt-dlp.

Uma etapa implementa o contrato `EtapaPipeline` de `src/dominio/pipeline.ts` e é
registrada no `Orquestrador`, que cuida da ordem, da gravação do resultado e dos erros.

| Pasta | Etapa | Situação |
|---|---|---|
| `ingestion/` | Agente de Arquivos: dados técnicos, integridade e problemas | Implementada |
| `analysis/` | Medição de imagem e áudio; análise de referências; Agente de Conteúdo para vídeos brutos | Implementada |
| `transcription/` | Fala → texto com tempo (Whisper local) | Implementada |
| `editing/` | Agentes de Planejamento, de Roteiro e de Edição: plano, roteiro e montagem da timeline | Implementada |
| `rendering/` | Motor de render: FFmpeg prepara trechos, HyperFrames gera cartões, Remotion compõe e codifica | Implementada |
| `quality-control/` | Verificação antes de exportar | Não implementada |

Arquivos de `analysis/`: `ferramentas.ts` (FFmpeg e FFprobe), `visual.ts` e `audio.ts`
(medição), `interpretacao.ts` (narrativa, tipos de conteúdo e leitura por modelos),
`regras.ts` (regras de edição, perfil de estilo e relatório Markdown) e `analisador.ts`
(ponto de entrada das referências) e `conteudo.ts` (vídeos brutos). Detalhes em
[docs/REFERENCIAS.md](../docs/REFERENCIAS.md) e [docs/PRODUCAO.md](../docs/PRODUCAO.md).

Os agentes são acionados pelo Coordenador (`src/nucleo/producao.ts`) e pela edição
(`src/nucleo/edicao.ts`). Os arquivos em `rendering/remotion/` são empacotados para o
navegador de render e não rodam direto no Node. Detalhes em [docs/EDICAO.md](../docs/EDICAO.md).

Regras: o resultado de uma etapa deve ser serializável em JSON; a etapa não acessa o
banco diretamente; mídias originais não são alteradas.
