// PDFs mínimos escritos à mão, para testar a leitura de manuais de marca sem arquivos externos.

/** Monta um PDF a partir dos objetos (o primeiro é o catálogo). Texto em Latin-1 (WinAnsi). */
function montar(objetos: Buffer[]): Buffer {
  const partes: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const posicoes: number[] = [];
  let tamanho = partes[0].length;
  objetos.forEach((corpo, i) => {
    posicoes.push(tamanho);
    const bloco = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), corpo, Buffer.from("\nendobj\n", "latin1")]);
    partes.push(bloco);
    tamanho += bloco.length;
  });
  const xref = [`xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`, ...posicoes.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`)].join("");
  partes.push(Buffer.from(`${xref}trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${tamanho}\n%%EOF\n`, "latin1"));
  return Buffer.concat(partes);
}

const txt = (s: string) => Buffer.from(s, "latin1");
const fluxo = (dicionario: string, dados: Buffer) => Buffer.concat([txt(`<< ${dicionario} /Length ${dados.length} >>\nstream\n`), dados, txt("\nendstream")]);

/**
 * Manual de duas páginas: na 1, cor primária em hexadecimal, destaque em RGB, tipografia
 * Montserrat (fonte do PDF "ABCDEF+Montserrat-Bold") e um logo 200×80 com transparência; na 2,
 * cor secundária em CMYK e uma menção a Pantone.
 */
export function manualDeMarca(): Buffer {
  const pagina1 = txt([
    "BT /F1 16 Tf 72 740 Td (Manual da marca Loja Azul) Tj ET",
    "BT /F1 12 Tf 72 700 Td (Cor prim\xe1ria: #1A2B3C) Tj ET",
    "BT /F1 12 Tf 72 680 Td (Cor de destaque RGB 255 200 0) Tj ET",
    "BT /F2 12 Tf 72 640 Td (Tipografia: Montserrat) Tj ET",
    "q 200 0 0 80 72 450 cm /Im1 Do Q",
  ].join("\n"));
  const pagina2 = txt("BT /F1 12 Tf 72 700 Td (Cor secund\xe1ria CMYK 0 100 100 0, Pantone 286 C) Tj ET");
  // Logo: metade esquerda azul, metade direita transparente.
  const pixels = Buffer.alloc(200 * 80 * 3);
  const mascara = Buffer.alloc(200 * 80);
  for (let y = 0; y < 80; y++) for (let x = 0; x < 200; x++) {
    const i = y * 200 + x;
    pixels[i * 3] = 0x1a; pixels[i * 3 + 1] = 0x2b; pixels[i * 3 + 2] = 0x3c;
    mascara[i] = x < 100 ? 255 : 0;
  }
  return montar([
    txt("<< /Type /Catalog /Pages 2 0 R >>"),
    txt("<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>"),
    txt("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 7 0 R /F2 8 0 R >> /XObject << /Im1 9 0 R >> >> >>"),
    txt("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>"),
    fluxo("", pagina1),
    fluxo("", pagina2),
    txt("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"),
    txt("<< /Type /Font /Subtype /Type1 /BaseFont /ABCDEF+Montserrat-Bold /Encoding /WinAnsiEncoding >>"),
    fluxo("/Type /XObject /Subtype /Image /Width 200 /Height 80 /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 10 0 R", pixels),
    fluxo("/Type /XObject /Subtype /Image /Width 200 /Height 80 /ColorSpace /DeviceGray /BitsPerComponent 8", mascara),
  ]);
}

/** Manual sem nenhum código de cor escrito: só um fundo vermelho e um título. */
export function manualSemCodigos(): Buffer {
  const pagina = txt(["1 0 0 rg 0 0 612 792 re f", "0 0 0 rg BT /F1 20 Tf 72 700 Td (Nossa marca) Tj ET"].join("\n"));
  return montar([
    txt("<< /Type /Catalog /Pages 2 0 R >>"),
    txt("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    txt("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"),
    fluxo("", pagina),
    txt("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
  ]);
}
