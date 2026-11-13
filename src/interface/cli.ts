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
  backup                           Grava uma cópia de segurança do banco
`;

async function executar(app: Aplicacao, argumentos: string[]): Promise<number> {
  const [comando, acao, ...resto] = argumentos;

  if (comando === "situacao") {
    const s = await app.situacao();
    console.log(`Dados:        ${s.pastaDados} (esquema v${s.versaoEsquema})`);
    console.log(`Projetos:     ${s.projetos}`);
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

  if (comando === "backup") {
    console.log(`Cópia gravada em ${app.copiaDeSeguranca()}`);
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
