// Ponto de entrada da composição do Remotion. Este arquivo e os dois ao lado são
// empacotados para o navegador de render; não são executados diretamente pelo Node.

import { registerRoot } from "remotion";
import { Raiz } from "./Raiz.tsx";

registerRoot(Raiz);
