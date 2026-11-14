"""Teste do Whisper (faster-whisper). Chamado por scripts/verificar/whisper.mjs.

Uso: python whisper_teste.py AUDIO DEVICE COMPUTE_TYPE MODELO
Imprime uma linha JSON com o resultado.
"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "Pipeline", "transcription"))
import gpu  # noqa: E402  (mesmo módulo que a aplicação usa)


def main() -> int:
    audio, device, compute_type, modelo = sys.argv[1:5]
    resultado = {"etapa": "importacao"}
    gpu.preparar()
    try:
        import ctranslate2
        import faster_whisper

        resultado.update(
            faster_whisper=faster_whisper.__version__,
            ctranslate2=ctranslate2.__version__,
            dispositivos_cuda=ctranslate2.get_cuda_device_count(),
            etapa="modelo",
        )

        def executar(dispositivo, calculo):
            inicio = time.time()
            whisper = faster_whisper.WhisperModel(modelo, device=dispositivo, compute_type=calculo)
            resultado.update(etapa="transcricao", carga_s=round(time.time() - inicio, 1), dispositivo_usado=dispositivo)
            segmentos, info = whisper.transcribe(audio, word_timestamps=True)
            return list(segmentos), info

        inicio = time.time()
        try:
            segmentos, info = executar(device, compute_type)
        except Exception as erro:
            if device != "cuda":
                raise
            # A aplicação faz o mesmo: sem GPU utilizável, transcreve pelo processador.
            resultado.update(gpu_falhou=f"{type(erro).__name__}: {erro}"[:300], etapa="modelo")
            inicio = time.time()
            segmentos, info = executar("cpu", "int8")
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
