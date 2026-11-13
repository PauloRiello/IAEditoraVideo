# Pipeline — processamento audiovisual

Cada pasta guarda a implementação de uma etapa. Só aqui o código executa FFmpeg,
FFprobe, Whisper, Remotion, HyperFrames e yt-dlp.

Uma etapa implementa o contrato `EtapaPipeline` de `src/dominio/pipeline.ts` e é
registrada no `Orquestrador`, que cuida da ordem, da gravação do resultado e dos erros.

| Pasta | Etapa | Situação |
|---|---|---|
| `ingestion/` | Entrada, validação e metadados | Não implementada |
| `analysis/` | Medição de imagem e áudio, interpretação e regras de edição | Implementada para vídeos de referência; etapa para vídeos brutos pendente |
| `transcription/` | Fala → texto com tempo (Whisper local) | Função implementada; etapa do pipeline pendente |
| `editing/` | Plano de edição | Não implementada |
| `rendering/` | Geração do vídeo | Não implementada |
| `quality-control/` | Verificação antes de exportar | Não implementada |

Arquivos de `analysis/`: `ferramentas.ts` (FFmpeg e FFprobe), `visual.ts` e `audio.ts`
(medição), `interpretacao.ts` (narrativa, tipos de conteúdo e leitura por modelos),
`regras.ts` (regras de edição, perfil de estilo e relatório Markdown) e `analisador.ts`
(ponto de entrada). Detalhes em [docs/REFERENCIAS.md](../docs/REFERENCIAS.md).

Regras: o resultado de uma etapa deve ser serializável em JSON; a etapa não acessa o
banco diretamente; mídias originais não são alteradas.
