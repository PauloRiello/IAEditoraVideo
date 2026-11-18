// Verifica as Agent Skills do Remotion e do HyperFrames instaladas em .claude/skills.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { RAIZ, Relatorio, lerJson } from "../lib/comum.mjs";

const r = new Relatorio("Agent Skills (Claude Code)");
const pasta = path.join(RAIZ, ".claude", "skills");
const trava = path.join(RAIZ, "skills-lock.json");

if (r.conferir(existsSync(trava), "skills-lock.json presente", "skills-lock.json ausente")) {
  const skills = lerJson(trava).skills;
  const origens = {};

  for (const [nome, dados] of Object.entries(skills)) {
    const arquivo = path.join(pasta, nome, "SKILL.md");
    const valido = existsSync(arquivo) && new RegExp(`^name:\\s*${nome}\\s*$`, "m").test(readFileSync(arquivo, "utf8"));
    if (!valido) r.falha(`${nome}: SKILL.md ausente ou inválido`);
    (origens[dados.source] ??= []).push(nome);
  }

  for (const origem of ["remotion-dev/skills", "heygen-com/hyperframes"]) {
    const nomes = origens[origem] ?? [];
    r.conferir(nomes.length > 0, `${origem}: ${nomes.length} skills (${nomes.join(", ")})`, `${origem}: nenhuma skill instalada`);
  }
}

r.finalizar();
