// Verifica o TypeScript e checa os tipos do projeto.
import { Relatorio, binLocal, executar, resumo, versoesDeclaradas } from "../lib/comum.mjs";

const r = new Relatorio("TypeScript");

const versao = executar(binLocal("tsc"), ["--version"]);
const declarada = versoesDeclaradas().typescript;
r.conferir(
  versao.ok && versao.saida.includes(declarada),
  `tsc ${versao.saida.replace("Version ", "")}`,
  `tsc: esperada ${declarada}, obtida "${versao.saida || versao.erro}"`,
);

const tipos = executar(binLocal("tsc"), ["--project", "tsconfig.json"]);
r.conferir(tipos.ok, "Checagem de tipos sem erros", `Erros de tipo: ${resumo(tipos.saida, 5)}`);

r.finalizar();
