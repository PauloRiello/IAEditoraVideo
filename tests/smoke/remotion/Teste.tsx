// Composição mínima usada só para testar a instalação (Remotion + React + GSAP).
// Não faz parte do editor.

import { gsap } from "gsap";
import React, { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

export const Teste: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const titulo = useRef<HTMLHeadingElement>(null);
  const linhaDoTempo = useRef<gsap.core.Timeline | null>(null);

  // A linha do tempo do GSAP fica pausada; quem decide o instante é o quadro do Remotion.
  useLayoutEffect(() => {
    const tl = gsap.timeline({ paused: true });
    tl.fromTo(
      titulo.current,
      { opacity: 0, x: -200 },
      { opacity: 1, x: 0, duration: 1, ease: "power2.out" },
    );
    linhaDoTempo.current = tl;
    return () => {
      tl.kill();
    };
  }, []);

  useLayoutEffect(() => {
    linhaDoTempo.current?.seek(frame / fps);
  }, [frame, fps]);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#101820",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <h1 ref={titulo} style={{ color: "#ffffff", fontFamily: "sans-serif", fontSize: 48 }}>
        Remotion + GSAP
      </h1>
    </AbsoluteFill>
  );
};
