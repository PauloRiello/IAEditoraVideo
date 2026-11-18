// Tela de abertura: mostra a etapa e a porcentagem que o processo principal informa.
const $ = (id) => document.getElementById(id);
const a = window.iaevAbertura;
$("versao").textContent = `versão ${a.versao}`;
a.aoMudar((estado) => {
  if (estado.erro) {
    $("andamento").style.display = "none";
    $("etapa").textContent = "Não foi possível abrir.";
    $("mensagem").textContent = estado.erro;
    $("registro").textContent = estado.registro ?? "";
    $("registro").style.display = estado.registro ? "block" : "none";
    $("falha").classList.add("visivel");
    return;
  }
  $("falha").classList.remove("visivel");
  $("andamento").style.display = "flex";
  $("etapa").textContent = estado.etapa;
  const porcento = Math.round(estado.fracao * 100);
  $("preenchido").style.width = `${porcento}%`;
  $("porcento").textContent = `${porcento}%`;
});
$("tentar").addEventListener("click", () => a.tentarDeNovo());
$("fechar").addEventListener("click", () => a.fechar());
