// Exemplo de uso da memória e do aprendizado. Executar: npm run exemplo:memoria
// Usa uma pasta temporária: não toca nos dados reais da aplicação.

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { montarCaminhos } from "../src/infra/caminhos.ts";
import { Aplicacao } from "../src/nucleo/aplicacao.ts";

const pasta = mkdtempSync(path.join(os.tmpdir(), "iaev-exemplo-"));
const caminhos = montarCaminhos(path.join(pasta, "dados"), path.join(pasta, "biblioteca"));
const titulo = (texto: string) => console.log(`\n== ${texto} ==`);

let app = new Aplicacao(caminhos);
try {
  titulo("1. Projetos e referências");
  const cidadeAlta = app.criarProjeto("Divulgação Cidade Alta", "fivem");
  const velhoOeste = app.criarProjeto("Divulgação Velho Oeste RP", "fivem");
  const referencia = app.acervo.adicionarReferencia({
    titulo: "Trailer que o cliente gostou",
    caminho: path.join(caminhos.referencias, "trailer.mp4"),
    perfil: "fivem",
    autorizacao: "Material enviado pelo cliente",
  });
  app.acervo.vincularReferencia(cidadeAlta.id, referencia.id);
  app.acervo.registrarAnalise({ referenciaId: referencia.id }, "ritmo", { cortesPorMinuto: 42, duracaoMediaPlanoSeg: 1.4 });
  console.log(`Projetos: ${app.projetos.listar().length}; análise guardada: ${JSON.stringify(app.acervo.analises({ referenciaId: referencia.id })[0].resultado)}`);

  titulo("2. Uma correção isolada não vira regra");
  const correcao = { categoria: "ritmo" as const, chave: "cortes-por-minuto", descricao: "Cortes mais rápidos, cerca de 40 por minuto", valor: 40 };
  const primeira = app.aprendizado.registrarCorrecao(cidadeAlta.id, correcao);
  console.log(`No projeto corrigido: ${primeira.doProjeto.estado}`);
  console.log(`No perfil fivem:      ${primeira.daEspecializacao.estado} (confiança ${primeira.daEspecializacao.confianca}, ${primeira.daEspecializacao.projetosObservados} projeto)`);
  console.log(`Aplicáveis ao outro projeto fivem: ${app.aprendizadosDoProjeto(velhoOeste.id).aplicaveis.length}`);

  titulo("3. A mesma correção em um segundo projeto promove o aprendizado");
  const segunda = app.aprendizado.registrarCorrecao(velhoOeste.id, correcao).daEspecializacao;
  console.log(`No perfil fivem:      ${segunda.estado} (confiança ${segunda.confianca}, ${segunda.projetosObservados} projetos)`);
  for (const e of app.aprendizado.evidencias(segunda.id)) console.log(`  evidência: ${e.origem}, projeto ${e.projetoId?.slice(0, 8)}`);

  titulo("4. Instrução explícita e orientação temporária");
  app.aprendizado.observar({
    escopo: "especializacao", perfil: "fivem", categoria: "cta", chave: "encerramento",
    descricao: "Terminar com o endereço do Discord na tela", valor: "discord", origem: "usuario",
  });
  app.aprendizado.observar({
    escopo: "temporaria", projetoId: cidadeAlta.id, categoria: "ritmo", chave: "cortes-por-minuto",
    descricao: "Só neste vídeo: ritmo mais lento, 20 cortes por minuto", valor: 20, origem: "usuario",
    expiraEm: new Date(Date.now() + 7 * 24 * 3_600_000).toISOString(),
  });
  for (const a of app.aprendizadosDoProjeto(cidadeAlta.id).aplicaveis) console.log(`  [${a.escopo}] ${a.categoria}/${a.chave}: ${a.descricao}`);

  titulo("5. Perfis combinados: o que é incompatível não se mistura");
  app.aprendizado.observar({
    escopo: "especializacao", perfil: "redes-sociais", categoria: "cta", chave: "encerramento",
    descricao: "Terminar pedindo para seguir o perfil", valor: "seguir", origem: "usuario",
  });
  const combinado = app.aprendizadosDoProjeto(velhoOeste.id, ["redes-sociais"]);
  console.log(`Aplicáveis: ${combinado.aplicaveis.map((a) => `${a.categoria}/${a.chave}`).join(", ")}`);
  for (const c of combinado.conflitos) console.log(`Conflito em ${c.categoria}/${c.chave}: ${c.opcoes.map((o) => `${o.perfil} → "${o.descricao}"`).join(" × ")}`);

  titulo("6. Plano de edição com histórico de versões");
  app.acervo.salvarPlano(cidadeAlta.id, { clipes: 12 }, "ia", "Primeira proposta");
  app.acervo.salvarPlano(cidadeAlta.id, { clipes: 15 }, "usuario", "Mais cenas de perseguição");
  app.acervo.restaurarPlano(cidadeAlta.id, 1);
  for (const v of app.acervo.historicoDePlanos(cidadeAlta.id)) console.log(`  v${v.versao} (${v.autor}): ${v.nota}`);

  titulo("7. Revisão: desativar um aprendizado");
  app.aprendizado.desativar(segunda.id);
  console.log(`Ativos agora: ${app.aprendizado.listar({ estado: "ativo" }).length}; desativados: ${app.aprendizado.listar({ estado: "desativado" }).length}`);

  titulo("8. Cópia de segurança, fechamento, reabertura e restauração");
  const copia = app.copiaDeSeguranca();
  app.projetos.remover(velhoOeste.id);
  console.log(`Projetos depois de remover um: ${app.projetos.listar().length}`);
  app.encerrar();

  app = new Aplicacao(caminhos); // como se o programa tivesse sido fechado e aberto de novo
  console.log(`Depois de reabrir: ${app.projetos.listar().length} projeto(s), ${app.aprendizado.listar().length} aprendizado(s)`);
  app.restaurar(copia.nome);
  console.log(`Depois de restaurar a cópia: ${app.projetos.listar().length} projeto(s)`);
} finally {
  app.encerrar();
  rmSync(pasta, { recursive: true, force: true });
}
