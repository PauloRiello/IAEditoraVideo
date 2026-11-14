// Encerra a IA Editora de Vídeo com segurança: renders em andamento são interrompidos sem
// deixar arquivo pela metade e o banco é fechado. Nada do que foi feito se perde.
// Uso: npm run parar   (no Windows: windows\Parar.cmd)

import { dizer, exigirInstalacao, parar, pastas } from "./lib/aplicacao.mjs";

exigirInstalacao();
const estava = await parar(pastas().dados);
dizer(estava ? "A IA Editora de Vídeo foi encerrada. Projetos, aprendizados e configurações estão salvos." : "A IA Editora de Vídeo não estava aberta.");
