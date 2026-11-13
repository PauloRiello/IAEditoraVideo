// Verifica o Python do sistema e o ambiente virtual do projeto.
import { existsSync } from "node:fs";
import { Relatorio, binVenv, executar, pythonDoSistema, resumo } from "../lib/comum.mjs";

const r = new Relatorio("Python e ambiente virtual");

const sistema = pythonDoSistema();
r.conferir(sistema, `Python do sistema ${sistema?.versao}`, "Python 3.11 ou mais recente não encontrado");

const python = binVenv("python");
if (r.conferir(existsSync(python), "Ambiente virtual .venv presente", "Ambiente .venv ausente (rode npm run setup)")) {
  const versao = executar(python, ["--version"]);
  r.conferir(versao.ok, `.venv: ${versao.saida}`, ".venv: interpretador não executa");

  const pip = executar(python, ["-m", "pip", "--version"]);
  r.conferir(pip.ok, `.venv: ${pip.saida.split(" from ")[0]}`, ".venv: pip indisponível");

  const conflito = executar(python, ["-m", "pip", "check"]);
  r.conferir(conflito.ok, "Dependências Python sem conflitos", `Conflito de dependências: ${resumo(conflito.saida)}`);
}

r.finalizar();
