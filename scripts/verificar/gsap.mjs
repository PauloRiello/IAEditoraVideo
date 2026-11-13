// Verifica o GSAP: versão e uma animação controlada por tempo (o modo usado em vídeo).
import { Relatorio, versaoPacote, versoesDeclaradas } from "../lib/comum.mjs";

const r = new Relatorio("GSAP");

try {
  const { gsap } = await import("gsap");
  const declarada = versoesDeclaradas().gsap;
  r.conferir(gsap.version === declarada, `gsap ${gsap.version}`, `gsap: esperada ${declarada}, carregada ${gsap.version}`);
  r.conferir(versaoPacote("gsap") === gsap.version, "Versão carregada igual à instalada");

  // Em vídeo, a linha do tempo fica pausada e cada quadro pede um instante exato.
  const alvo = { x: 0 };
  const tl = gsap.timeline({ paused: true });
  tl.to(alvo, { x: 100, duration: 1, ease: "none" });

  tl.seek(0.5);
  r.conferir(Math.abs(alvo.x - 50) < 1e-6, "seek(0.5) leva o valor a 50", `seek(0.5) resultou em ${alvo.x}`);
  tl.seek(1);
  r.conferir(Math.abs(alvo.x - 100) < 1e-6, "seek(1.0) leva o valor a 100", `seek(1.0) resultou em ${alvo.x}`);
  tl.seek(0.25);
  r.conferir(Math.abs(alvo.x - 25) < 1e-6, "seek para trás é determinístico (25)", `seek(0.25) resultou em ${alvo.x}`);
  tl.kill();
} catch (erro) {
  r.falha(`Não foi possível carregar o GSAP: ${erro.message}`);
}

r.finalizar();
