"""Transcreve a fala de um arquivo de áudio ou vídeo com o faster-whisper.

Uso: python transcrever.py ARQUIVO MODELO DISPOSITIVO TIPO_DE_CALCULO IDIOMA PASTA_DE_MODELOS
Imprime um objeto JSON na saída padrão. IDIOMA vazio = detectar automaticamente.
Chamado por whisper.ts; roda inteiramente no computador do usuário.
"""

import json
import sys


def main() -> int:
    arquivo, modelo, dispositivo, calculo, idioma, pasta = sys.argv[1:7]
    from faster_whisper import WhisperModel

    whisper = WhisperModel(modelo, device=dispositivo, compute_type=calculo, download_root=pasta or None)
    # O filtro de voz evita que o modelo "invente" frases sobre música ou ruído.
    segmentos, info = whisper.transcribe(arquivo, language=idioma or None, vad_filter=True)
    lista = [{"inicioSeg": round(s.start, 2), "fimSeg": round(s.end, 2), "texto": s.text.strip()} for s in segmentos]
    lista = [s for s in lista if s["texto"]]
    resultado = {
        "idioma": info.language if lista else "",
        "texto": " ".join(s["texto"] for s in lista),
        "tempoDeFalaSeg": round(sum(s["fimSeg"] - s["inicioSeg"] for s in lista), 2),
        "segmentos": lista,
    }
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(resultado, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as erro:  # a mensagem vai para o chamador decidir o que fazer
        print(f"{type(erro).__name__}: {erro}", file=sys.stderr)
        sys.exit(1)
