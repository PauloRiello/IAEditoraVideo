"""Bibliotecas de GPU do Whisper (CUDA 12 e cuDNN 9).

O faster-whisper só usa a placa NVIDIA se conseguir carregar o cuBLAS e o cuDNN. O pip os
instala dentro do ambiente virtual (pacotes nvidia-*-cu12), em pastas que o sistema não
procura sozinho. Este módulo as torna visíveis e confere se carregam de verdade: ter o
driver e a placa não basta.

Uso direto: python gpu.py   (imprime a situação em JSON; usado pela detecção de GPU)
"""

import ctypes
import glob
import json
import os
import sys

WINDOWS = os.name == "nt"
BIBLIOTECAS = ("cublas64_12.dll", "cudnn64_9.dll") if WINDOWS else ("libcublas.so.12", "libcudnn.so.9")


def _pastas_nvidia():
    pastas = []
    for base in sys.path:
        raiz = os.path.join(base, "nvidia")
        if os.path.isdir(raiz):
            # No Windows as DLLs ficam em "bin"; no Linux, as bibliotecas ficam em "lib".
            for subpasta in ("bin", "lib"):
                pastas += glob.glob(os.path.join(raiz, "*", subpasta))
    return [pasta for pasta in pastas if os.path.isdir(pasta)]


def preparar():
    """Torna visíveis as bibliotecas NVIDIA instaladas pelo pip. Chamar antes de usar o Whisper."""
    pastas = _pastas_nvidia()
    if WINDOWS:
        for pasta in pastas:
            try:
                os.add_dll_directory(pasta)
            except OSError:
                pass
        # O ctranslate2 carrega o cuBLAS e o cuDNN pelo nome, procurando no caminho de busca.
        os.environ["PATH"] = os.pathsep.join(pastas + [os.environ.get("PATH", "")])
    else:
        for pasta in pastas:
            for nome in BIBLIOTECAS:
                arquivo = os.path.join(pasta, nome)
                if os.path.exists(arquivo):
                    try:
                        ctypes.CDLL(arquivo, mode=ctypes.RTLD_GLOBAL)
                    except OSError:
                        pass
    return pastas


def situacao():
    """Diz se a GPU pode ser usada pelo Whisper e, se não puder, por quê."""
    preparar()
    resultado = {"instalado": False, "dispositivos": 0, "bibliotecas": False, "motivo": ""}
    try:
        import ctranslate2

        resultado["instalado"] = True
        resultado["dispositivos"] = ctranslate2.get_cuda_device_count()
    except Exception as erro:  # sem o faster-whisper não há o que conferir
        resultado["motivo"] = f"{type(erro).__name__}: {erro}"[:300]
        return resultado
    if resultado["dispositivos"] < 1:
        resultado["motivo"] = "nenhuma placa compatível com CUDA visível"
        return resultado
    faltando = []
    for nome in BIBLIOTECAS:
        try:
            ctypes.CDLL(nome)
        except OSError:
            faltando.append(nome)
    resultado["bibliotecas"] = not faltando
    if faltando:
        resultado["motivo"] = "bibliotecas não encontradas: " + ", ".join(faltando)
    return resultado


if __name__ == "__main__":
    print(json.dumps(situacao(), ensure_ascii=False))
