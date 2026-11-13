import React from "react";
import { Composition } from "remotion";
import { Teste } from "./Teste";

export const Raiz: React.FC = () => {
  return (
    <Composition
      id="Teste"
      component={Teste}
      durationInFrames={30}
      fps={30}
      width={640}
      height={360}
    />
  );
};
