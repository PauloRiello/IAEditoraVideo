"""Extrai de um manual de marca em PDF o que o programa precisa para sugerir a identidade
visual: texto de cada página, nomes das fontes usadas, imagens embutidas (candidatas a logo) e
as páginas como imagem (para medir cores). Só extrai; a interpretação fica no TypeScript.

Uso: python ler_manual.py <arquivo.pdf> <pasta_de_saida>
Fala em linhas JSON: {"pagina": n, "total": t} durante o trabalho e, no fim, o resultado, ou
{"erro": "senha" | "invalido" | "outro", "mensagem": "..."} com código 1.
"""

import json
import os
import struct
import sys
import zlib

LARGURA_DA_PAGINA = 800


def falar(objeto):
    sys.stdout.write(json.dumps(objeto, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def gravar_png(caminho, largura, altura, linhas, canais):
    """PNG sem compressão especial, com zlib da biblioteca padrão (sem Pillow)."""
    tipo = {3: 2, 4: 6}[canais]
    bruto = b"".join(b"\x00" + linha for linha in linhas)

    def bloco(nome, dados):
        return struct.pack(">I", len(dados)) + nome + dados + struct.pack(">I", zlib.crc32(nome + dados) & 0xFFFFFFFF)

    with open(caminho, "wb") as arquivo:
        arquivo.write(b"\x89PNG\r\n\x1a\n")
        arquivo.write(bloco(b"IHDR", struct.pack(">IIBBBBB", largura, altura, 8, tipo, 0, 0, 0)))
        arquivo.write(bloco(b"IDAT", zlib.compress(bruto, 6)))
        arquivo.write(bloco(b"IEND", b""))


def linhas_rgb(bitmap):
    """Linhas RGB ou RGBA de um bitmap do pdfium, na ordem certa dos canais."""
    import pypdfium2.raw as raw

    largura, altura, passo = bitmap.width, bitmap.height, bitmap.stride
    dados = bytes(bitmap.buffer)
    formato = bitmap.format
    if formato == raw.FPDFBitmap_Gray:
        canais_origem, canais = 1, 3
    elif formato == raw.FPDFBitmap_BGR:
        canais_origem, canais = 3, 3
    else:  # BGRx ou BGRA
        canais_origem, canais = 4, 4 if formato == raw.FPDFBitmap_BGRA else 3
    ja_rgb = getattr(bitmap, "rev_byteorder", False)
    linhas = []
    alfa = False
    for y in range(altura):
        linha = dados[y * passo: y * passo + largura * canais_origem]
        if canais_origem == 1:
            saida = bytes(b for v in linha for b in (v, v, v))
        else:
            saida = bytearray()
            for x in range(largura):
                p = linha[x * canais_origem: (x + 1) * canais_origem]
                r, g, b = (p[0], p[1], p[2]) if ja_rgb else (p[2], p[1], p[0])
                saida += bytes((r, g, b))
                if canais == 4:
                    saida.append(p[3])
                    if p[3] < 250:
                        alfa = True
            saida = bytes(saida)
        linhas.append(saida)
    return largura, altura, linhas, canais, alfa


def nomes_das_fontes(leitor):
    vistos = []
    for numero, pagina in enumerate(leitor.pages, start=1):
        try:
            fontes = pagina.get("/Resources", {}).get_object().get("/Font", {}).get_object()
        except Exception:
            continue
        for referencia in fontes.values():
            try:
                nome = str(referencia.get_object().get("/BaseFont", "")).lstrip("/")
            except Exception:
                continue
            if "+" in nome and len(nome.split("+", 1)[0]) == 6:
                nome = nome.split("+", 1)[1]  # prefixo de subconjunto (ABCDEF+)
            if nome and not any(f["nome"] == nome for f in vistos):
                vistos.append({"nome": nome, "pagina": numero})
    return vistos


def main(arquivo, saida):
    os.makedirs(saida, exist_ok=True)
    try:
        from pypdf import PdfReader
        from pypdf.errors import PdfReadError
        import pypdfium2 as pdfium
        import pypdfium2.raw as raw
    except ImportError as erro:
        falar({"erro": "outro", "mensagem": f"leitor de PDF não instalado ({erro})"})
        return 1

    try:
        leitor = PdfReader(arquivo)
        if leitor.is_encrypted and not leitor.decrypt(""):
            falar({"erro": "senha", "mensagem": "protegido por senha"})
            return 1
        _ = len(leitor.pages)
    except (PdfReadError, ValueError, OSError, KeyError) as erro:
        falar({"erro": "invalido", "mensagem": str(erro)})
        return 1
    except Exception as erro:  # pypdf pede senha com erros diferentes conforme a versão
        texto = str(erro).lower()
        falar({"erro": "senha" if "password" in texto or "decrypt" in texto else "invalido", "mensagem": str(erro)})
        return 1

    try:
        documento = pdfium.PdfDocument(arquivo)
    except pdfium.PdfiumError as erro:
        falar({"erro": "senha" if "password" in str(erro).lower() else "invalido", "mensagem": str(erro)})
        return 1

    total = len(documento)
    paginas, imagens, renderizadas = [], [], []
    for indice in range(total):
        numero = indice + 1
        pagina = documento[indice]
        largura_pt, altura_pt = pagina.get_width(), pagina.get_height()
        texto = pagina.get_textpage().get_text_bounded()
        paginas.append({"numero": numero, "texto": texto})

        bitmap = pagina.render(scale=LARGURA_DA_PAGINA / largura_pt, rev_byteorder=True)
        largura, altura, linhas, canais, _ = linhas_rgb(bitmap)
        destino = os.path.join(saida, f"pagina-{numero}.png")
        gravar_png(destino, largura, altura, linhas, canais)
        renderizadas.append({"arquivo": destino, "pagina": numero})

        for ordem, objeto in enumerate(pagina.get_objects(filter=[raw.FPDF_PAGEOBJ_IMAGE], max_depth=3)):
            try:
                imagem = objeto.get_bitmap(render=True)
                largura, altura, linhas, canais, alfa = linhas_rgb(imagem)
                esquerda, baixo, direita, topo = objeto.get_bounds()
            except Exception:
                continue
            destino = os.path.join(saida, f"imagem-{numero}-{ordem + 1}.png")
            gravar_png(destino, largura, altura, linhas, canais)
            fracao = max(0.0, (direita - esquerda) * (topo - baixo)) / max(1.0, largura_pt * altura_pt)
            imagens.append({"arquivo": destino, "pagina": numero, "largura": largura, "altura": altura, "transparencia": alfa, "fracaoDaPagina": round(fracao, 4)})
        falar({"pagina": numero, "total": total})

    falar({"paginas": paginas, "fontes": nomes_das_fontes(leitor), "imagens": imagens, "renderizadas": renderizadas})
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        falar({"erro": "outro", "mensagem": "uso: ler_manual.py <arquivo.pdf> <pasta_de_saida>"})
        sys.exit(1)
    sys.exit(main(sys.argv[1], sys.argv[2]))
