// Verifica Node.js, npm e os pacotes npm do projeto.
import { Relatorio, executar, versaoPacote, versoesDeclaradas, WINDOWS } from "../lib/comum.mjs";

const r = new Relatorio("Node.js e pacotes npm");

const [maior, menor] = process.versions.node.split(".").map(Number);
r.conferir(
  maior > 22 || (maior === 22 && menor >= 20),
  `Node.js ${process.versions.node}`,
  `Node.js ${process.versions.node}: é preciso 22.20 ou mais recente`,
);

const npm = executar(WINDOWS ? "npm.cmd" : "npm", ["--version"]);
r.conferir(npm.ok, `npm ${npm.saida}`, "npm não encontrado");

for (const [nome, declarada] of Object.entries(versoesDeclaradas())) {
  const instalada = versaoPacote(nome);
  r.conferir(
    instalada === declarada,
    `${nome} ${instalada}`,
    `${nome}: declarada ${declarada}, instalada ${instalada ?? "nenhuma"} (rode npm install)`,
  );
}

// O Remotion exige que todos os seus pacotes estejam na mesma versão.
r.conferir(
  versaoPacote("remotion") === versaoPacote("@remotion/cli"),
  "remotion e @remotion/cli na mesma versão",
  "remotion e @remotion/cli em versões diferentes",
);

r.finalizar();
