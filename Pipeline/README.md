# Pipeline — processamento audiovisual

Cada pasta guarda a implementação de uma etapa. Só aqui o código executa FFmpeg,
FFprobe, Whisper, Remotion, HyperFrames e yt-dlp.

Uma etapa implementa o contrato `EtapaPipeline` de `src/dominio/pipeline.ts` e é
registrada no `Orquestrador`, que cuida da ordem, da gravação do resultado e dos erros.

| Pasta | Etapa | Situação |
|---|---|---|
| `ingestion/` | Entrada, validação e metadados | Não implementada |
| `analysis/` | Cenas, silêncios, qualidade, estilo das referências | Não implementada |
| `transcription/` | Fala → texto com tempo | Não implementada |
| `editing/` | Plano de edição | Não implementada |
| `rendering/` | Geração do vídeo | Não implementada |
| `quality-control/` | Verificação antes de exportar | Não implementada |

Regras: o resultado de uma etapa deve ser serializável em JSON; a etapa não acessa o
banco diretamente; mídias originais não são alteradas.
