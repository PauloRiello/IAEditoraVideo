// Lógica do aplicativo que não depende do Electron, para poder ser testada com o Node.

import path from "node:path";

/**
 * Variáveis de ambiente do servidor (somadas às do aplicativo). O próprio executável do
 * aplicativo roda como Node; o FFmpeg baixado pela preparação vem antes no PATH.
 */
export function ambienteDoServidor({ dados, biblioteca, ambiente, pathAtual, registro }) {
  return {
    ELECTRON_RUN_AS_NODE: "1",
    IAEV_ANFITRIAO: "1",
    IAEV_INSTALADO: "1",
    IAEV_DADOS: dados,
    IAEV_BIBLIOTECA: biblioteca,
    IAEV_AMBIENTE: ambiente,
    IAEV_REGISTRO: registro,
    PATH: `${path.join(ambiente, "ferramentas", "ffmpeg", "bin")}${path.delimiter}${pathAtual}`,
  };
}

const lista = (valor) => (Array.isArray(valor) ? valor.map(String) : []);

/** Interpreta uma linha JSON do servidor ou da preparação; o que não for reconhecido vira null. */
export function lerLinha(linha) {
  let m;
  try {
    m = JSON.parse(linha);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  if (typeof m.etapa === "string" && typeof m.fracao === "number") return { tipo: "etapa", etapa: m.etapa, fracao: m.fracao };
  if (m.pronta === true && typeof m.porta === "number" && typeof m.token === "string") return { tipo: "pronta", porta: m.porta, token: m.token, avisos: lista(m.avisos), jaAberta: m.jaAberta === true };
  if (m.pronto === true) return { tipo: "preparado", faltando: lista(m.faltando), avisos: lista(m.avisos) };
  if (typeof m.erro === "string") return { tipo: "erro", mensagem: m.erro };
  return null;
}

const limitar = (x) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));

/** Posição na barra da tela de abertura: preparação ocupa 0 a 70%; abertura, 70 a 100%. */
export function fracaoDaAbertura(fase, fracao) {
  return fase === "preparando" ? 0.7 * limitar(fracao) : 0.7 + 0.3 * limitar(fracao);
}

/** Uma atualização só é instalada sem análise, render ou outra tarefa na fila ou em andamento. */
export function podeInstalarAgora(tarefas) {
  return !tarefas.some((t) => t.estado === "na-fila" || t.estado === "executando");
}

/** Texto do andamento da atualização automática, para a página de configurações. */
export function textoDaAtualizacao({ tipo, versao, fracao }) {
  switch (tipo) {
    case "verificando": return "Procurando atualizações…";
    case "disponivel": return `Versão ${versao} disponível: baixando…`;
    case "baixando": return `Baixando a versão ${versao}: ${Math.round(limitar(fracao) * 100)}%`;
    case "baixada": return `Versão ${versao} pronta. Ela é instalada ao fechar o programa, ou agora em “Reiniciar e atualizar”.`;
    case "sem-novidade": return "Você está usando a versão mais recente.";
    default: return "Não foi possível procurar atualizações agora. O programa tenta de novo mais tarde.";
  }
}

/**
 * Pasta dos vídeos e exportações: a da variável, a escolhida antes, a criada pelo Instalar.cmd
 * (Documentos\IA Editora de Video, sem acento) ou, nas instalações antigas pelo código-fonte,
 * a com acento. Sem nenhuma, a mesma padrão do Instalar.cmd. `documentos` é a pasta Documentos
 * real do Windows (que pode estar no OneDrive).
 */
export function escolherBiblioteca({ variavel, guardada, documentos, existe }) {
  if (variavel) return variavel;
  if (guardada) return guardada;
  const candidatas = [path.join(documentos, "IA Editora de Video"), path.join(documentos, "IA Editora de Vídeo")];
  return candidatas.find((p) => existe(p)) ?? candidatas[0];
}

/**
 * Pasta de trabalho do servidor: dentro do ambiente, fora da pasta do programa. O Remotion
 * guarda o navegador de render e o cache da composição a partir dela, e a atualização
 * substitui a pasta do programa.
 */
export function pastaDeTrabalhoDoServidor(ambiente) {
  return ambiente;
}
