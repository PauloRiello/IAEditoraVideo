// Detecta a GPU, grava a configuração de aceleração e confere se ela é coerente.
import { Relatorio } from "../lib/comum.mjs";
import { descrever, detectar, gravar } from "../detectar_gpu.mjs";

const r = new Relatorio("GPU e aceleração");

try {
  const a = await detectar();
  const gravado = gravar(a);
  for (const linha of descrever(a)) r.ok(linha);

  for (const [encoder, funciona] of Object.entries(a.ffmpeg.encodersTestados)) {
    if (!funciona) r.ok(`Encoder ${encoder} listado pelo FFmpeg, mas sem hardware compatível: descartado`);
  }
  if (!a.gpu) r.aviso("Sem GPU: transcrição e render usam CPU (funciona, porém mais lento)");
  if (a.whisper.bibliotecasCudaPendentes) {
    r.aviso("GPU NVIDIA presente, mas o Whisper não a enxerga: rode `npm run setup` para instalar cuBLAS e cuDNN");
  }
  r.ok(gravado ? "Configuração gravada em config/local.aceleracao.json" : "Configuração manual existente preservada");
} catch (erro) {
  r.falha(`Detecção falhou: ${erro.message}`);
}

r.finalizar();
