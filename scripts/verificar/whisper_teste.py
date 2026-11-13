"""Teste do Whisper (faster-whisper). Chamado por scripts/verificar/whisper.mjs.

Uso: python whisper_teste.py AUDIO DEVICE COMPUTE_TYPE MODELO
Imprime uma linha JSON com o resultado.
"""

import json
import sys
import time


def main() -> int:
    audio, device, compute_type, modelo = sys.argv[1:5]
    resultado = {"etapa": "importacao"}
    try:
        import ctranslate2
        import faster_whisper

        resultado.update(
            faster_whisper=faster_whisper.__version__,
            ctranslate2=ctranslate2.__version__,
            dispositivos_cuda=ctranslate2.get_cuda_device_count(),
            etapa="modelo",
        )
        inicio = time.time()
        whisper = faster_whisper.WhisperModel(modelo, device=device, compute_type=compute_type)
        resultado.update(etapa="transcricao", carga_s=round(time.time() - inicio, 1))

        inicio = time.time()
        segmentos, info = whisper.transcribe(audio, word_timestamps=True)
        segmentos = list(segmentos)
        resultado.update(
            etapa="concluido",
            texto=" ".join(s.text.strip() for s in segmentos),
            idioma=info.language,
            duracao_s=round(info.duration, 2),
            palavras_com_tempo=sum(len(s.words or []) for s in segmentos),
            transcricao_s=round(time.time() - inicio, 1),
        )
    except Exception as erro:  # o chamador decide como relatar
        resultado["erro"] = f"{type(erro).__name__}: {erro}"[:400]
    print(json.dumps(resultado, ensure_ascii=False))
    return 0 if resultado["etapa"] == "concluido" else 1


if __name__ == "__main__":
    sys.exit(main())
