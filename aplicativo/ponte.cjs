// Ponte entre o aplicativo e as páginas (tela de abertura e janela principal). As páginas
// não acessam o Node: só o que está aqui.
const { contextBridge, ipcRenderer } = require("electron");

const versao = ipcRenderer.sendSync("iaev:versao");
// Um só ouvinte da atualização: a página redesenha a seção várias vezes.
let ouvinteDaAtualizacao = null;
ipcRenderer.on("iaev:atualizacao", (_evento, texto, pronta) => ouvinteDaAtualizacao?.(texto, pronta));

contextBridge.exposeInMainWorld("iaevAbertura", {
  versao,
  aoMudar: (f) => ipcRenderer.on("iaev:abertura", (_evento, estado) => f(estado)),
  tentarDeNovo: () => ipcRenderer.send("iaev:tentar-de-novo"),
  fechar: () => ipcRenderer.send("iaev:fechar"),
});

contextBridge.exposeInMainWorld("iaevAplicativo", {
  versao,
  estadoDaAtualizacao: () => ipcRenderer.sendSync("iaev:estado-atualizacao"),
  aoMudarAtualizacao: (f) => { ouvinteDaAtualizacao = f; },
  reiniciarParaAtualizar: () => ipcRenderer.send("iaev:reiniciar-para-atualizar"),
});
