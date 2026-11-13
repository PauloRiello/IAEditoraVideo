// Interface de linha de comando. Como toda interface, só conversa com a classe Aplicacao.
// Uso: npm run app -- <comando>

import { ErroAplicacao } from "../dominio/erros.ts";
import { Aplicacao } from "../nucleo/aplicacao.ts";

const AJUDA = `IA Editora de Vídeo

Comandos:
  situacao                         Mostra o estado da aplicação
  perfis                           Lista os perfis de especialização
  projeto criar <nome> [perfil]    Cria um projeto
  projeto listar                   Lista os projetos
  aprendizados [estado]            Lista os aprendizados (candidato, ativo ou desativado)
  aprendizado desativar <id>       Desativa um aprendizado
  aprendizado ativar <id>          Ativa um aprendizado por decisão do usuário
  aprendizado excluir <id>         Exclui um aprendizado
  backup                           Grava uma cópia de segurança
  backup listar                    Lista as cópias de segurança
  backup restaurar <nome>          Restaura uma cópia (o estado atual é guardado antes)
`;

async function executar(app: Aplicacao, argumentos: string[]): Promise<number> {
  const [comando, acao, ...resto] = argumentos;

  if (comando === "situacao") {
    const s = await app.situacao();
    console.log(`Dados:        ${s.pastaDados} (esquema v${s.versaoEsquema})`);
    for (const aviso of s.avisos) console.log(`Aviso:        ${aviso}`);
    console.log(`Projetos:     ${s.projetos}`);
    console.log(`Aprendizados: ${s.aprendizadosAtivos} ativo(s)`);
    console.log(`Backups:      ${s.copiasDeSeguranca}`);
    console.log(`Perfis:       ${s.perfis.join(", ") || "nenhum"}`);
    console.log(`Etapas:       ${s.etapasRegistradas.join(", ") || "nenhuma implementada"}`);
    console.log(`Computador:   ${s.hardware.nucleos} núcleos, ${s.hardware.memoriaTotalMB} MB de RAM`);
    console.log(`GPU:          ${s.hardware.gpu ? `${s.hardware.gpu.nome} (${s.vramLivreMB} MB livres para IA)` : "nenhuma (processamento por CPU)"}`);
    const provedores = s.provedores.map((p) => `${p.id} [${p.origem}, ${p.disponivel ? "disponível" : "indisponível"}]`);
    console.log(`Provedores:   ${provedores.join(", ") || "nenhum configurado (operações locais continuam funcionando)"}`);
    return 0;
  }

  if (comando === "perfis") {
    for (const p of app.perfis.listar()) console.log(`${p.id.padEnd(10)} ${p.nome} — formato padrão: ${p.formatoPadrao}`);
    return 0;
  }

  if (comando === "projeto" && acao === "criar" && resto[0]) {
    const projeto = app.criarProjeto(resto[0], resto[1]);
    console.log(`Projeto criado: ${projeto.nome} (${projeto.id}), perfil ${projeto.perfil}, formato ${projeto.formato}`);
    return 0;
  }

  if (comando === "projeto" && acao === "listar") {
    const projetos = app.projetos.listar();
    if (projetos.length === 0) console.log("Nenhum projeto.");
    for (const p of projetos) console.log(`${p.id}  ${p.nome}  [${p.perfil} / ${p.formato}]`);
    return 0;
  }

  if (comando === "aprendizados") {
    const lista = app.aprendizado.listar(acao ? { estado: acao as "candidato" | "ativo" | "desativado" } : {});
    if (lista.length === 0) console.log("Nenhum aprendizado.");
    for (const a of lista) {
      const dono = a.escopo === "especializacao" ? `perfil ${a.perfil}` : a.escopo === "projeto" ? "projeto" : a.escopo;
      console.log(`#${a.id} [${a.estado}, ${dono}, confiança ${a.confianca}, ${a.evidencias} evidência(s)] ${a.categoria}/${a.chave}: ${a.descricao}`);
    }
    return 0;
  }

  if (comando === "aprendizado" && ["desativar", "ativar", "excluir"].includes(acao) && resto[0]) {
    const id = Number(resto[0]);
    if (acao === "desativar") app.aprendizado.desativar(id);
    else if (acao === "ativar") app.aprendizado.ativar(id);
    else app.aprendizado.excluir(id);
    console.log(`Aprendizado #${id}: ${acao} concluído.`);
    return 0;
  }

  if (comando === "backup" && !acao) {
    console.log(`Cópia gravada em ${app.copiaDeSeguranca().pasta}`);
    return 0;
  }

  if (comando === "backup" && acao === "listar") {
    const copias = app.copias();
    if (copias.length === 0) console.log("Nenhuma cópia de segurança.");
    for (const c of copias) console.log(`${c.nome}  (${c.motivo})`);
    return 0;
  }

  if (comando === "backup" && acao === "restaurar" && resto[0]) {
    const anterior = app.restaurar(resto[0]);
    console.log(`Cópia restaurada. O estado anterior foi guardado em ${anterior.nome}.`);
    return 0;
  }

  console.log(AJUDA);
  return comando ? 1 : 0;
}

const app = new Aplicacao();
try {
  process.exitCode = await executar(app, process.argv.slice(2));
} catch (erro) {
  console.error(erro instanceof ErroAplicacao ? `Erro: ${erro.message}` : erro);
  process.exitCode = 1;
} finally {
  app.encerrar();
}
