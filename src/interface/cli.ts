// Interface de linha de comando. Como toda interface, só conversa com a classe Aplicacao.
// Uso: npm run app -- <comando>

import path from "node:path";
import { ErroAplicacao } from "../dominio/erros.ts";
import type { PlanoDeEdicao } from "../dominio/producao.ts";
import { Aplicacao } from "../nucleo/aplicacao.ts";

const AJUDA = `IA Editora de Vídeo

Comandos:
  situacao                         Mostra o estado da aplicação
  perfis                           Lista os perfis de especialização
  projeto criar <nome> [perfil]    Cria um projeto
  projeto listar                   Lista os projetos
  agentes                          Lista os agentes da aplicação
  brutos importar <projeto>        Registra no projeto os vídeos novos de Videos Brutos/
  brutos analisar <projeto>        Examina, analisa e indexa os vídeos brutos do projeto
  pesquisar <palavras>             Pesquisa nos vídeos brutos (falas, ação, características)
  plano gerar <projeto> <objetivo> [--duracao s] [--publico p] [--plataforma p] [--cta texto] [--fato texto]
  plano ver <projeto>              Mostra a versão atual do plano
  plano aprovar <projeto>          Aprova o plano atual
  plano rejeitar <projeto> <motivo>
  roteiro <projeto>                Escreve o roteiro do plano atual
  referencias importar             Registra os vídeos novos da pasta Referências/
  referencias listar               Lista as referências registradas
  referencias analisar <id|todas>  Analisa referências e grava os relatórios
  aprendizados [estado]            Lista os aprendizados (candidato, ativo ou desativado)
  aprendizado desativar <id>       Desativa um aprendizado
  aprendizado ativar <id>          Ativa um aprendizado por decisão do usuário
  aprendizado excluir <id>         Exclui um aprendizado
  backup                           Grava uma cópia de segurança
  backup listar                    Lista as cópias de segurança
  backup restaurar <nome>          Restaura uma cópia (o estado atual é guardado antes)
`;

function mostrarPlano(plano: PlanoDeEdicao, versao: number, estado: string): void {
  console.log(`Plano v${versao} (${estado}) — ${plano.objetivo}`);
  console.log(`Formato: ${plano.formato.nome} · ${plano.duracaoPlanejadaSeg} s planejados de ${plano.duracaoDesejadaSeg} s desejados`);
  for (const c of plano.clipes) {
    console.log(`  ${String(c.inicioLinhaDoTempoSeg).padStart(6)} s  [${c.bloco}] ${path.basename(c.arquivo)} ${c.inicioOrigemSeg}–${c.fimOrigemSeg} s — ${c.motivo}`);
  }
  console.log(`Transições: ${plano.transicoes.padrao}, encerramento em ${plano.transicoes.encerramento}`);
  console.log(`Áudio: ${plano.audio.descricao}`);
  console.log(`Legendas: ${plano.legendas.ativas ? `${plano.legendas.itens.length} fala(s)` : "não"} · Trilha: ${plano.trilhaSonora.observacao}`);
  if (plano.efeitos.length) console.log(`Efeitos: ${plano.efeitos.join(" ")}`);
  console.log(`CTA: ${plano.cta ? plano.cta.texto : "nenhum"}`);
  for (const aviso of plano.avisos) console.log(`Aviso: ${aviso}`);
}

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

  if (comando === "agentes") {
    for (const a of app.producao.listarAgentes()) console.log(`${a.nome}: ${a.responsabilidade}`);
    return 0;
  }

  if (comando === "brutos" && acao === "importar" && resto[0]) {
    const novas = app.producao.importarBrutos(resto[0]);
    console.log(novas.length ? `${novas.length} vídeo(s) registrado(s) no projeto.` : "Nenhum vídeo novo em Videos Brutos/.");
    return 0;
  }

  if (comando === "brutos" && acao === "analisar" && resto[0]) {
    for (const b of await app.producao.analisarBrutos(resto[0])) {
      const t = b.arquivo.tecnico;
      console.log(`${b.arquivo.nome}: ${t ? `${t.largura}x${t.altura}, ${t.fps} quadros/s, ${t.duracaoSeg.toFixed(1)} s, ${b.arquivo.formato}/${t.codecVideo}` : "não lido"} — ${b.arquivo.integridade}`);
      if (b.conteudo) console.log(`  ${b.conteudo.cenas.length} cena(s), ${b.conteudo.momentosDeAcao.length} momento(s) de ação, ${b.conteudo.destaques.length} destaque(s), ${b.conteudo.transcricao?.segmentos.length ?? 0} fala(s)`);
      for (const p of [...b.arquivo.problemas, ...(b.conteudo?.possiveisErros ?? [])]) console.log(`  ${p.gravidade}: ${p.descricao}${p.inicioSeg !== undefined ? ` (${p.inicioSeg}–${p.fimSeg} s)` : ""}`);
    }
    return 0;
  }

  if (comando === "pesquisar" && acao) {
    const resultados = app.producao.pesquisar([acao, ...resto].join(" "), { limite: 20 });
    if (resultados.length === 0) console.log("Nada encontrado.");
    for (const r of resultados) console.log(`${r.arquivo}  ${r.inicioSeg}–${r.fimSeg} s  [${r.tipo}] ${r.texto} (${r.etiquetas.join(", ")})`);
    return 0;
  }

  if (comando === "plano" && acao === "gerar" && resto[1]) {
    const opcao = (nome: string) => resto.flatMap((valor, i) => (valor === `--${nome}` && resto[i + 1] ? [resto[i + 1]] : []));
    const versao = app.producao.planejar(resto[0], {
      objetivo: resto[1], publico: opcao("publico")[0], plataforma: opcao("plataforma")[0], cta: opcao("cta")[0], fatos: opcao("fato"),
      duracaoDesejadaSeg: opcao("duracao")[0] ? Number(opcao("duracao")[0]) : undefined,
    });
    mostrarPlano(versao.plano as PlanoDeEdicao, versao.versao, versao.estado);
    return 0;
  }

  if (comando === "plano" && acao === "ver" && resto[0]) {
    const versao = app.acervo.plano(resto[0]);
    mostrarPlano(versao.plano as PlanoDeEdicao, versao.versao, versao.estado);
    return 0;
  }

  if (comando === "plano" && acao === "aprovar" && resto[0]) {
    console.log(`Plano v${app.producao.aprovarPlano(resto[0]).versao} aprovado.`);
    return 0;
  }

  if (comando === "plano" && acao === "rejeitar" && resto[1]) {
    console.log(`Plano v${app.producao.rejeitarPlano(resto[0], resto.slice(1).join(" ")).versao} rejeitado.`);
    return 0;
  }

  if (comando === "roteiro" && acao) {
    const roteiro = await app.producao.escreverRoteiro(acao);
    for (const linha of roteiro.linhas) console.log(`[${linha.bloco}] (${linha.tipo}) ${linha.texto}`);
    for (const aviso of roteiro.avisos) console.log(`Aviso: ${aviso}`);
    return 0;
  }

  if (comando === "referencias" && acao === "importar") {
    const novas = app.referencias.importarPasta();
    console.log(novas.length ? `${novas.length} referência(s) registrada(s):` : "Nenhum vídeo novo na pasta Referências/.");
    for (const r of novas) console.log(`  ${r.id}  ${r.titulo}  [${r.perfil ?? "sem perfil"}]`);
    return 0;
  }

  if (comando === "referencias" && acao === "listar") {
    const todas = app.acervo.referencias();
    if (todas.length === 0) console.log("Nenhuma referência registrada.");
    for (const r of todas) console.log(`${r.id}  ${r.titulo}  [${r.perfil ?? "sem perfil"}]  ${app.referencias.relatorio(r.id) ? "analisada" : "não analisada"}`);
    return 0;
  }

  if (comando === "referencias" && acao === "analisar" && resto[0]) {
    const alvos = resto[0] === "todas" ? app.acervo.referencias().filter((r) => r.caminho) : [app.acervo.referencia(resto[0])];
    for (const alvo of alvos) {
      console.log(`Analisando "${alvo.titulo}"...`);
      const { relatorio, arquivoMarkdown, aprendizados } = await app.referencias.analisar(alvo.id);
      const ativos = aprendizados.filter((a) => a.estado === "ativo").length;
      console.log(`  ${relatorio.regras.length} regra(s), confiança geral ${Math.round(relatorio.confiancaGeral * 100)}%; ${ativos} aprendizado(s) já ativo(s), ${aprendizados.length - ativos} candidato(s)`);
      for (const limitacao of relatorio.limitacoes) console.log(`  Limitação: ${limitacao}`);
      console.log(`  Relatório: ${arquivoMarkdown}`);
    }
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
