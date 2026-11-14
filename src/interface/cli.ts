// Interface de linha de comando. Como toda interface, só conversa com a classe Aplicacao.
// Uso: npm run app -- <comando>

import path from "node:path";
import { ErroAplicacao } from "../dominio/erros.ts";
import type { PlanoDeEdicao } from "../dominio/producao.ts";
import type { RelatorioDeQualidade } from "../dominio/qualidade.ts";
import type { Exportacao, Operacao, VersaoDaTimeline } from "../dominio/timeline.ts";
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
  estilos                          Lista os estilos de edição
  montar <projeto> [--estilo id]   Monta a timeline do plano aprovado (aceita vários --estilo)
  timeline <projeto>               Mostra a timeline atual
  editar <projeto> '<operação>'    Aplica uma operação em JSON, por exemplo {"tipo":"remover","id":"clipe-2"}
  desfazer <projeto>               Volta à versão anterior da timeline
  trilha <projeto> <arquivo>       Define a trilha sonora
  previa <projeto>                 Renderiza uma prévia de baixa qualidade
  exportar <projeto> [--preset id] [--destino perfil]   Renderiza o vídeo final (MP4, H.264 + AAC), com controle de qualidade
  presets                          Lista os presets de exportação e os perfis de qualidade
  qualidade <projeto> [--destino perfil]   Confere a timeline antes de exportar
  relatorio <exportação>           Mostra o relatório de qualidade de uma exportação
  aceitar <relatório> <verificação> <justificativa>   Aceita um problema não crítico
  repetir <exportação>             Repete uma exportação
  exportacoes <projeto>            Mostra o histórico de exportações
  avaliar <projeto> <aprovar|rejeitar|alterar> [motivo] [--nota aspecto=1..5] [--trecho inicio-fim:comentário]
  avaliacoes <projeto>             Mostra as avaliações e os trechos pendentes de revisão
  desfazer-avaliacao <id>          Desfaz o que uma avaliação ensinou
  comparar <projeto> [de] [para]   Compara duas versões da timeline
  resultado <projeto> <plataforma> [--metrica valor ...] [--evidencia texto]   Registra métricas informadas
  aprendido [perfil]               Mostra o que foi aprendido, por contexto
  aprendizado acoes                Lista as ações feitas sobre aprendizados
  aprendizado desfazer <acao>      Desfaz uma correção, desativação, ativação ou exclusão
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

function mostrarTimeline(v: VersaoDaTimeline): void {
  const { formato, duracaoSeg, itens, efeitosGlobais } = v.timeline;
  console.log(`Timeline v${v.versao} (${v.autor}) — ${v.nota}`);
  console.log(`${formato.largura}x${formato.altura}, ${formato.fps} quadros/s, ${duracaoSeg} s${efeitosGlobais.length ? `, ${efeitosGlobais.map((e) => e.tipo).join(", ")}` : ""}`);
  for (const i of [...itens].sort((a, b) => a.camada - b.camada || a.inicioSeg - b.inicioSeg)) {
    const detalhe =
      i.tipo === "video" ? `${path.basename(i.arquivo)} a partir de ${i.inicioOrigemSeg} s${i.entrada.tipo === "gradual" ? ", entrada gradual" : ""}${i.efeitos.length ? `, ${i.efeitos.map((e) => e.tipo).join("+")}` : ""}`
      : i.tipo === "audio" ? `${i.papel}: ${path.basename(i.arquivo)}, volume ${i.volume}`
      : i.tipo === "cartao" ? `"${i.titulo}"` : i.tipo === "imagem" ? path.basename(i.arquivo) : `"${i.texto}"`;
    console.log(`  camada ${String(i.camada).padStart(2)}  ${String(i.inicioSeg).padStart(7)} s  +${i.duracaoSeg} s  ${i.id} [${i.tipo}] ${detalhe}`);
  }
}

function mostrarRelatorio(r: RelatorioDeQualidade): void {
  const reprovadas = r.verificacoes.filter((v) => v.situacao === "reprovada");
  console.log(`Relatório de qualidade #${r.id} (destino ${r.perfilDeQualidade}): ${r.situacao} — ${r.verificacoes.filter((v) => v.situacao === "aprovada").length} aprovadas, ${reprovadas.length} com problema`);
  for (const v of reprovadas) {
    const aceita = r.excecoes.find((e) => e.verificacaoId === v.id);
    console.log(`  [${v.gravidade}] ${v.id}: ${v.detalhe}${aceita ? ` (exceção aceita: ${aceita.justificativa})` : ""}`);
    if (!aceita) console.log(`      Sugestão: ${v.sugestao}`);
  }
}

function mostrarExportacao(e: Exportacao): void {
  const dados = e.arquivo ? ` — ${e.largura}x${e.altura}, ${e.fps} quadros/s, ${e.duracaoSeg?.toFixed(2)} s, ${Math.round((e.tamanhoBytes ?? 0) / 1024)} KB` : "";
  console.log(`#${e.id} ${e.tipo} da timeline v${e.versaoDaTimeline}: ${e.estado}${dados}`);
  if (e.arquivo) console.log(`  ${e.arquivo}`);
  if (e.verificacao) console.log(`  Conferência: ${e.verificacao.aprovada ? "aprovada" : e.verificacao.problemas.join("; ")}`);
  if (e.erro) console.log(`  Erro: ${e.erro}`);
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

  if (comando === "estilos") {
    for (const e of app.estilos.listar()) console.log(`${e.id.padEnd(22)} ${e.nome} — ${e.descricao}`);
    return 0;
  }

  if (comando === "montar" && acao) {
    const estilos = resto.flatMap((valor, i) => (valor === "--estilo" && resto[i + 1] ? [resto[i + 1]] : []));
    const versao = app.edicao.montar(acao, { estilos });
    mostrarTimeline(versao);
    for (const d of versao.decisoes) console.log(`Escolha: ${d.aspecto} → ${d.decisao} (${d.origem})`);
    for (const aviso of versao.avisos) console.log(`Aviso: ${aviso}`);
    return 0;
  }

  if (comando === "timeline" && acao) {
    mostrarTimeline(app.edicao.timeline(acao));
    return 0;
  }

  if (comando === "editar" && acao && resto[0]) {
    mostrarTimeline(app.edicao.editar(acao, JSON.parse(resto.join(" ")) as Operacao));
    return 0;
  }

  if (comando === "desfazer" && acao) {
    mostrarTimeline(app.edicao.restaurar(acao));
    return 0;
  }

  if (comando === "trilha" && acao && resto[0]) {
    mostrarTimeline(app.edicao.definirTrilha(acao, resto[0]));
    return 0;
  }

  if ((comando === "previa" || comando === "exportar") && acao) {
    let ultimo = -1;
    app.eventos.on("render:progresso", (p: { fase: string; progresso: number }) => {
      const passo = Math.floor(p.progresso * 10);
      if (passo !== ultimo) { ultimo = passo; console.log(`  ${p.fase}: ${passo * 10}%`); }
      if (p.fase === "conferindo") console.log("  conferindo o arquivo exportado...");
    });
    // Ctrl+C cancela o render com segurança, sem deixar arquivo pela metade.
    const opcao = (nome: string) => resto.flatMap((valor, i) => (valor === `--${nome}` && resto[i + 1] ? [resto[i + 1]] : []))[0];
    const tarefa = comando === "previa" ? app.edicao.previa(acao) : app.edicao.exportar(acao, { preset: opcao("preset"), perfilDeQualidade: opcao("destino") });
    process.once("SIGINT", () => app.edicao.cancelar(tarefa.exportacao.id));
    const exportacao = await tarefa.conclusao;
    mostrarExportacao(exportacao);
    const relatorio = comando === "exportar" ? app.qualidade.relatorioDaExportacao(exportacao.id) : null;
    if (relatorio) mostrarRelatorio(relatorio);
    return exportacao.estado === "concluida" ? 0 : 1;
  }

  if (comando === "repetir" && acao) {
    const exportacao = await app.edicao.repetir(Number(acao)).conclusao;
    mostrarExportacao(exportacao);
    return exportacao.estado === "concluida" ? 0 : 1;
  }

  if (comando === "presets") {
    console.log("Presets de exportação:");
    for (const p of app.catalogoDeQualidade.listarPresets()) console.log(`  ${p.id.padEnd(16)} ${p.nome}`);
    console.log("Perfis de qualidade (destinos):");
    for (const p of app.catalogoDeQualidade.listarPerfis()) console.log(`  ${p.id.padEnd(16)} ${p.nome}`);
    return 0;
  }

  if (comando === "qualidade" && acao) {
    const destino = resto.flatMap((valor, i) => (valor === "--destino" && resto[i + 1] ? [resto[i + 1]] : []))[0];
    mostrarRelatorio(await app.qualidade.verificarTimeline(acao, { perfil: destino }));
    return 0;
  }

  if (comando === "relatorio" && acao) {
    const relatorio = app.qualidade.relatorioDaExportacao(Number(acao));
    if (!relatorio) throw new ErroAplicacao("sem-relatorio", "Esta exportação não tem relatório de qualidade.");
    console.log(app.qualidade.markdown(relatorio.id));
    return 0;
  }

  if (comando === "aceitar" && acao && resto[1]) {
    mostrarRelatorio(app.qualidade.aceitarExcecao(Number(acao), resto[0], resto.slice(1).join(" ")));
    return 0;
  }

  if (comando === "exportacoes" && acao) {
    const lista = app.edicao.exportacoes(acao);
    if (lista.length === 0) console.log("Nenhuma exportação.");
    for (const e of lista) mostrarExportacao(e);
    return 0;
  }

  if (comando === "avaliar" && acao && resto[0]) {
    const decisoes = { aprovar: "aprovada", rejeitar: "rejeitada", alterar: "alteracoes-solicitadas" } as const;
    const decisao = decisoes[resto[0] as keyof typeof decisoes];
    if (!decisao) throw new ErroAplicacao("decisao-invalida", "Use aprovar, rejeitar ou alterar.");
    const opcoes = (nome: string) => resto.flatMap((valor, i) => (valor === `--${nome}` && resto[i + 1] ? [resto[i + 1]] : []));
    const primeiraOpcao = resto.findIndex((valor) => valor.startsWith("--"));
    const r = app.feedback.avaliar(acao, {
      decisao,
      motivo: resto.slice(1, primeiraOpcao < 0 ? undefined : primeiraOpcao).join(" "),
      notas: Object.fromEntries(opcoes("nota").map((par) => [par.split("=")[0], Number(par.split("=")[1])])),
      trechos: opcoes("trecho").map((texto) => {
        const [intervalo, ...comentario] = texto.split(":");
        const [inicioSeg, fimSeg] = intervalo.split("-").map(Number);
        return { inicioSeg, fimSeg, comentario: comentario.join(":") };
      }),
    });
    console.log(`Avaliação #${r.id}: edição v${r.versaoDaTimeline} ${r.decisao}.`);
    for (const c of r.aprendizado.correcoes) console.log(`  Correção registrada: ${c.categoria}/${c.chave} → ${c.valor}`);
    console.log(`  Aprendizados confirmados: ${r.aprendizado.confirmados}; contestados: ${r.aprendizado.contestados}; trechos para revisão: ${r.trechos.length}`);
    return 0;
  }

  if (comando === "avaliacoes" && acao) {
    for (const a of app.feedback.avaliacoes(acao)) {
      const notas = Object.entries(a.notas).map(([aspecto, nota]) => `${aspecto} ${nota}`).join(", ");
      console.log(`#${a.id} edição v${a.versaoDaTimeline}: ${a.decisao}${a.motivo ? ` — ${a.motivo}` : ""}${notas ? ` [${notas}]` : ""}${a.desfeita ? " (aprendizado desfeito)" : ""}`);
    }
    for (const t of app.feedback.trechosEmRevisao(acao)) console.log(`Trecho pendente #${t.id}: ${t.inicioSeg}–${t.fimSeg} s — ${t.comentario}`);
    return 0;
  }

  if (comando === "desfazer-avaliacao" && acao) {
    console.log(`Aprendizado da avaliação desfeito: ${app.feedback.desfazerAvaliacao(Number(acao)).aprendizadosAfetados} aprendizado(s) afetado(s).`);
    return 0;
  }

  if (comando === "comparar" && acao) {
    const c = app.feedback.compararVersoes(acao, resto[0] ? Number(resto[0]) : undefined, resto[1] ? Number(resto[1]) : undefined);
    console.log(`Timeline v${c.de} → v${c.para}`);
    for (const linha of c.resumo) console.log(`  ${linha}`);
    for (const i of c.itens.adicionados) console.log(`  + ${i.id} [${i.tipo}]`);
    for (const i of c.itens.removidos) console.log(`  - ${i.id} [${i.tipo}]`);
    for (const i of c.itens.alterados) console.log(`  ~ ${i.id}: ${i.campos.map((campo) => campo.campo).join(", ")}`);
    if (c.resumo.length + c.itens.adicionados.length + c.itens.removidos.length + c.itens.alterados.length === 0) console.log("  As versões são iguais.");
    return 0;
  }

  if (comando === "resultado" && acao && resto[0]) {
    const metricas: Record<string, number> = {};
    let evidenciaDeAtribuicao: string | undefined;
    for (let i = 1; i < resto.length - 1; i += 2) {
      if (resto[i] === "--evidencia") evidenciaDeAtribuicao = resto[i + 1];
      else metricas[resto[i].replace(/^--/, "")] = Number(resto[i + 1]);
    }
    const r = app.feedback.registrarResultado(acao, { plataforma: resto[0], metricas, evidenciaDeAtribuicao });
    console.log(`Resultado #${r.id} registrado em ${r.plataforma}. Leitura: ${r.leitura.sinal}.`);
    console.log(`  ${r.leitura.observacao}`);
    return 0;
  }

  if (comando === "aprendido") {
    const painel = app.feedback.painel();
    const mostrar = (titulo: string, lista: typeof painel.geral) => {
      if (lista.length === 0) return;
      console.log(titulo);
      for (const a of lista) console.log(`  #${a.id} [${a.estado}, confiança ${a.confianca}, ${a.evidencias} a favor, ${a.contrarias} contra, ${a.projetosObservados} fonte(s)] ${a.categoria}/${a.chave} = ${JSON.stringify(a.valor)}`);
    };
    if (!acao) mostrar("Preferências gerais", painel.geral);
    for (const [perfil, lista] of Object.entries(painel.perfis)) if (!acao || acao === perfil) mostrar(`Perfil ${perfil}`, lista);
    if (!acao) for (const [projeto, lista] of Object.entries(painel.projetos)) mostrar(`Projeto ${app.projetos.obter(projeto).nome}`, lista);
    if (!acao) mostrar("Orientações temporárias", painel.temporarias);
    return 0;
  }

  if (comando === "aprendizado" && acao === "acoes") {
    for (const a of app.aprendizado.acoes()) console.log(`#${a.id} ${a.acao}${a.desfeita ? " (desfeita)" : ""}: ${a.descricao}`);
    return 0;
  }

  if (comando === "aprendizado" && acao === "desfazer" && resto[0]) {
    const a = app.aprendizado.desfazerAcao(Number(resto[0]));
    console.log(`Ação desfeita. Aprendizado #${a.id} voltou a: ${a.estado}, ${a.categoria}/${a.chave} = ${JSON.stringify(a.valor)}`);
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
  await app.edicao.cancelarTudo();
  app.encerrar();
}
