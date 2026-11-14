// Controle de qualidade: escolhe o perfil do destino, aciona o Agente de Qualidade, guarda
// os relatórios e registra as exceções que o usuário aceitar. Uma verificação obrigatória
// reprovada nunca pode ser aceita nem ignorada.

import { AgenteDeQualidade } from "../../Pipeline/quality-control/verificador.ts";
import { ErroAplicacao, NaoEncontrado } from "../dominio/erros.ts";
import type { PlanoDeEdicao } from "../dominio/producao.ts";
import type { ExcecaoAceita, PerfilDeQualidade, RelatorioDeQualidade, SituacaoFinal, Verificacao } from "../dominio/qualidade.ts";
import type { Exportacao, VersaoDaTimeline } from "../dominio/timeline.ts";
import { agora, type Banco } from "../infra/banco.ts";
import type { ServicoAcervo } from "../servicos/acervo.ts";
import type { ServicoProjetos } from "../servicos/projetos.ts";
import type { ServicoDeQualidade } from "../servicos/qualidade.ts";
import type { ServicoTimeline } from "../servicos/timeline.ts";

export interface DependenciasDaQualidade {
  banco: Banco;
  projetos: ServicoProjetos;
  acervo: ServicoAcervo;
  timelines: ServicoTimeline;
  catalogo: ServicoDeQualidade;
}

interface Linha {
  id: number; projeto_id: string; versao_da_timeline: number; exportacao_id: number | null; arquivo: string | null; perfil_de_qualidade: string;
  situacao: SituacaoFinal; verificacoes: string; excecoes: string; criado_em: string;
}

const paraRelatorio = (l: Linha): RelatorioDeQualidade => ({
  id: l.id, projetoId: l.projeto_id, versaoDaTimeline: l.versao_da_timeline, exportacaoId: l.exportacao_id, arquivo: l.arquivo, perfilDeQualidade: l.perfil_de_qualidade,
  verificacoes: JSON.parse(l.verificacoes), excecoes: JSON.parse(l.excecoes), situacao: l.situacao, criadoEm: l.criado_em,
});

/** Situação final de um relatório. Obrigatória reprovada = reprovado, sem exceção possível. */
export function situacaoFinal(verificacoes: Verificacao[], excecoes: ExcecaoAceita[]): SituacaoFinal {
  const reprovadas = verificacoes.filter((v) => v.situacao === "reprovada");
  if (reprovadas.some((v) => v.gravidade === "obrigatoria")) return "reprovado";
  const aceitas = new Set(excecoes.map((e) => e.verificacaoId));
  if (reprovadas.some((v) => v.gravidade === "importante" && !aceitas.has(v.id))) return "pendente";
  return reprovadas.length ? "aprovado-com-ressalvas" : "aprovado";
}

const SITUACOES: Record<SituacaoFinal, string> = {
  aprovado: "Aprovado", "aprovado-com-ressalvas": "Aprovado com ressalvas", pendente: "Pendente: há problemas importantes que precisam ser corrigidos ou aceitos",
  reprovado: "Reprovado: há falha em verificação obrigatória",
};
const GRAVIDADES = { obrigatoria: "obrigatória", importante: "importante", recomendacao: "recomendação" } as const;

/** Relatório legível: situação final, problemas com gravidade e sugestão, e verificações aprovadas. */
export function relatorioEmMarkdown(r: RelatorioDeQualidade, nomeDoProjeto: string): string {
  const reprovadas = r.verificacoes.filter((v) => v.situacao === "reprovada");
  const aceitas = new Map(r.excecoes.map((e) => [e.verificacaoId, e]));
  const ordem = { obrigatoria: 0, importante: 1, recomendacao: 2 };
  const linhas = [
    `# Relatório de qualidade: ${nomeDoProjeto}`,
    `Timeline v${r.versaoDaTimeline} · Destino: **${r.perfilDeQualidade}** · ${r.criadoEm.slice(0, 16).replace("T", " ")}${r.arquivo ? `\n\nArquivo: \`${r.arquivo}\`` : "\n\nVerificação da timeline, antes do render."}`,
    `## Situação final: ${SITUACOES[r.situacao]}`,
    `${r.verificacoes.filter((v) => v.situacao === "aprovada").length} verificações aprovadas, ${reprovadas.length} com problema, ${r.verificacoes.filter((v) => v.situacao === "nao-aplicavel").length} que não se aplicam a este vídeo.`,
    "## Problemas encontrados",
    reprovadas.length === 0
      ? "Nenhum."
      : [
          "| Gravidade | Verificação | O que foi encontrado | Como corrigir | Exceção |",
          "|---|---|---|---|---|",
          ...[...reprovadas].sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade]).map((v) => {
            const excecao = aceitas.get(v.id);
            const coluna = excecao ? `Aceita: ${excecao.justificativa}` : v.gravidade === "obrigatoria" ? "Não pode ser aceita" : v.gravidade === "importante" ? "Aguardando decisão" : "—";
            return `| ${GRAVIDADES[v.gravidade]} | ${v.nome}${v.base === "estimado" ? " (estimativa)" : ""} | ${v.detalhe} | ${v.sugestao} | ${coluna} |`;
          }),
        ].join("\n"),
    "## Verificações aprovadas",
    r.verificacoes.filter((v) => v.situacao === "aprovada").map((v) => `- **${v.nome}**: ${v.detalhe}`).join("\n") || "Nenhuma.",
    "## Não se aplicam a este vídeo",
    r.verificacoes.filter((v) => v.situacao === "nao-aplicavel" || v.situacao === "nao-avaliada").map((v) => `- ${v.nome}: ${v.detalhe}`).join("\n") || "Nenhuma.",
  ];
  return `${linhas.join("\n\n")}\n`;
}

export class Qualidade {
  agente = new AgenteDeQualidade();
  private d: DependenciasDaQualidade;

  constructor(dependencias: DependenciasDaQualidade) {
    this.d = dependencias;
  }

  /** Plano atual do projeto, se houver: dá a plataforma de destino e diz se há chamada para ação prevista. */
  private plano(projetoId: string): PlanoDeEdicao | null {
    try {
      return this.d.acervo.plano(projetoId).plano as PlanoDeEdicao;
    } catch (erro) {
      if (erro instanceof NaoEncontrado) return null;
      throw erro;
    }
  }

  /** Perfil de qualidade do destino de um vídeo, pelo formato, pela plataforma do plano e pelo perfil do projeto. Pode ser escolhido explicitamente. */
  perfilPara(projetoId: string, formato: { largura: number; altura: number }, pedido?: string): PerfilDeQualidade {
    return this.d.catalogo.escolherPerfil({
      pedido, plataforma: this.plano(projetoId)?.plataforma, perfilDoProjeto: this.d.projetos.obter(projetoId).perfil, vertical: formato.altura > formato.largura,
    });
  }

  private gravar(projetoId: string, versao: number, perfil: string, verificacoes: Verificacao[], exportacaoId: number | null, arquivo: string | null): RelatorioDeQualidade {
    const r = this.d.banco
      .prepare("INSERT INTO relatorios_de_qualidade (projeto_id, versao_da_timeline, exportacao_id, arquivo, perfil_de_qualidade, situacao, verificacoes, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(projetoId, versao, exportacaoId, arquivo, perfil, situacaoFinal(verificacoes, []), JSON.stringify(verificacoes), agora());
    return this.relatorio(Number(r.lastInsertRowid));
  }

  /** Confere a timeline antes de renderizar: o que já dá para saber sem gerar o vídeo. */
  async verificarTimeline(projetoId: string, opcoes: { versao?: number; perfil?: string } = {}): Promise<RelatorioDeQualidade> {
    const versao = this.d.timelines.obter(projetoId, opcoes.versao);
    const perfil = this.perfilPara(projetoId, versao.timeline.formato, opcoes.perfil);
    const verificacoes = await this.agente.verificarTimeline(versao.timeline, { perfil, ctaPrevisto: Boolean(this.plano(projetoId)?.cta) });
    return this.gravar(projetoId, versao.versao, perfil.id, verificacoes, null, null);
  }

  /** Confere um arquivo exportado (e a timeline que o gerou) e grava o relatório ligado à exportação. */
  async verificarExportacao(exportacao: Exportacao, arquivo: string, versao: VersaoDaTimeline, esperado: { largura: number; altura: number; fps: number }, perfilPedido?: string): Promise<RelatorioDeQualidade> {
    const perfil = this.perfilPara(exportacao.projetoId, versao.timeline.formato, perfilPedido);
    const contexto = { perfil, ctaPrevisto: Boolean(this.plano(exportacao.projetoId)?.cta) };
    const verificacoes = [
      ...(await this.agente.verificarArquivo(arquivo, versao.timeline, { ...contexto, esperado, tentativas: exportacao.tentativas })),
      ...(await this.agente.verificarTimeline(versao.timeline, contexto)),
    ];
    return this.gravar(exportacao.projetoId, versao.versao, perfil.id, verificacoes, exportacao.id, arquivo);
  }

  relatorio(id: number): RelatorioDeQualidade {
    const linha = this.d.banco.prepare("SELECT * FROM relatorios_de_qualidade WHERE id = ?").get(id) as unknown as Linha | undefined;
    if (!linha) throw new NaoEncontrado("Relatório de qualidade", String(id));
    return paraRelatorio(linha);
  }

  /** Relatório mais recente de uma exportação, se houver. */
  relatorioDaExportacao(exportacaoId: number): RelatorioDeQualidade | null {
    const linha = this.d.banco.prepare("SELECT * FROM relatorios_de_qualidade WHERE exportacao_id = ? ORDER BY id DESC LIMIT 1").get(exportacaoId) as unknown as Linha | undefined;
    return linha ? paraRelatorio(linha) : null;
  }

  /** Relatórios de um projeto, do mais recente para o mais antigo. */
  relatorios(projetoId: string): RelatorioDeQualidade[] {
    return (this.d.banco.prepare("SELECT * FROM relatorios_de_qualidade WHERE projeto_id = ? ORDER BY id DESC").all(projetoId) as unknown as Linha[]).map(paraRelatorio);
  }

  /** Atualiza o caminho do arquivo de um relatório (o vídeo é movido depois de conferido). */
  definirArquivo(id: number, arquivo: string): RelatorioDeQualidade {
    this.d.banco.prepare("UPDATE relatorios_de_qualidade SET arquivo = ? WHERE id = ?").run(arquivo, id);
    return this.relatorio(id);
  }

  /**
   * O usuário aceita, com justificativa, um problema não crítico. Verificações obrigatórias
   * não podem ser aceitas: o problema precisa ser corrigido.
   */
  aceitarExcecao(relatorioId: number, verificacaoId: string, justificativa: string): RelatorioDeQualidade {
    const relatorio = this.relatorio(relatorioId);
    const verificacao = relatorio.verificacoes.find((v) => v.id === verificacaoId);
    if (!verificacao) throw new NaoEncontrado("Verificação", verificacaoId);
    if (verificacao.situacao !== "reprovada") throw new ErroAplicacao("sem-problema", `A verificação "${verificacao.nome}" não tem problema a aceitar.`);
    if (verificacao.gravidade === "obrigatoria") {
      throw new ErroAplicacao("excecao-nao-permitida", `"${verificacao.nome}" é uma verificação obrigatória: o problema precisa ser corrigido, não pode ser aceito.`);
    }
    if (!justificativa.trim()) throw new ErroAplicacao("justificativa-obrigatoria", "Informe por que o problema está sendo aceito.");
    const excecoes = [...relatorio.excecoes.filter((e) => e.verificacaoId !== verificacaoId), { verificacaoId, justificativa: justificativa.trim(), aceitaEm: agora() }];
    this.d.banco.prepare("UPDATE relatorios_de_qualidade SET excecoes = ?, situacao = ? WHERE id = ?").run(JSON.stringify(excecoes), situacaoFinal(relatorio.verificacoes, excecoes), relatorioId);
    return this.relatorio(relatorioId);
  }

  markdown(relatorioId: number): string {
    const relatorio = this.relatorio(relatorioId);
    return relatorioEmMarkdown(relatorio, this.d.projetos.obter(relatorio.projetoId).nome);
  }
}
