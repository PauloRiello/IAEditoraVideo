// Atualização automática pelos lançamentos publicados no GitHub (electron-updater).
// Procura ao abrir e a cada 6 horas, baixa em segundo plano com porcentagem e só instala
// quando o aplicativo pede: ao fechar ou em "Reiniciar e atualizar", depois da cópia de
// segurança e sem trabalho em andamento. Falhas de rede só vão para o registro.

import updater from "electron-updater";
import { textoDaAtualizacao } from "./estado.mjs";

const { autoUpdater } = updater;
const SEIS_HORAS = 6 * 60 * 60_000;

/**
 * @param {{ aoMudar: (texto: string, pronta: boolean) => void, registrar: (texto: string) => void }} o
 * @returns {{ estado: () => { texto: string, pronta: boolean }, pronta: () => boolean, instalar: () => void }}
 */
export function iniciarAtualizacao({ aoMudar, registrar }) {
  let atual = { texto: "", pronta: false };
  let versao = "";
  const mudar = (evento) => {
    atual = { texto: textoDaAtualizacao({ ...evento, versao }), pronta: evento.tipo === "baixada" };
    aoMudar(atual.texto, atual.pronta);
  };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // quem decide a hora é o aplicativo
  autoUpdater.logger = { info: registrar, warn: registrar, error: registrar, debug: () => undefined };
  autoUpdater.on("checking-for-update", () => { if (!atual.pronta) mudar({ tipo: "verificando" }); });
  autoUpdater.on("update-available", (info) => { versao = info.version; mudar({ tipo: "disponivel" }); });
  autoUpdater.on("download-progress", (p) => mudar({ tipo: "baixando", fracao: p.percent / 100 }));
  autoUpdater.on("update-downloaded", (info) => { versao = info.version; registrar(`Atualização ${versao} baixada.`); mudar({ tipo: "baixada" }); });
  autoUpdater.on("update-not-available", () => mudar({ tipo: "sem-novidade" }));
  autoUpdater.on("error", (erro) => { registrar(`Atualização: ${erro?.message ?? erro}`); if (!atual.pronta) mudar({ tipo: "erro" }); });
  const procurar = () => autoUpdater.checkForUpdates().catch((erro) => registrar(`Atualização: ${erro?.message ?? erro}`));
  void procurar();
  setInterval(procurar, SEIS_HORAS).unref();
  return {
    estado: () => atual,
    pronta: () => atual.pronta,
    /** Fecha o aplicativo e instala em silêncio; reabre só se pedido ("Reiniciar e atualizar"). */
    instalar: (reabrir = false) => autoUpdater.quitAndInstall(true, reabrir),
  };
}
