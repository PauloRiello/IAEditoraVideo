#!/usr/bin/env node
// Motor de IA simulado para os testes: fala o mesmo protocolo do llama-server (llama.cpp),
// sem modelo de verdade. Responde em JSON com os campos que a aplicação pede e anota cada
// pedido em IAEV_MOTOR_REGISTRO, para o teste conferir o que foi enviado.
import { appendFileSync } from "node:fs";
import http from "node:http";

const argumentos = process.argv.slice(2);
const valor = (nome) => argumentos[argumentos.indexOf(nome) + 1];
const porta = Number(valor("--port"));
const naPlaca = valor("-ngl") !== "0";
const registro = process.env.IAEV_MOTOR_REGISTRO;
const anotar = (dados) => { if (registro) appendFileSync(registro, `${JSON.stringify(dados)}\n`); };

anotar({ evento: "iniciado", pid: process.pid, argumentos });
// Simula uma placa de vídeo que não funciona: fecha ao tentar usá-la.
if (naPlaca && process.env.IAEV_MOTOR_FALHA_NA_PLACA === "1") {
  console.error("ggml_vulkan: no compatible device found");
  process.exit(1);
}

let pronto = false;
setTimeout(() => { pronto = true; }, 300); // carregar o modelo leva um tempo

http.createServer((pedido, resposta) => {
  const json = (estado, dados) => { resposta.writeHead(estado, { "content-type": "application/json" }); resposta.end(JSON.stringify(dados)); };
  if (pedido.url === "/health") return pronto ? json(200, { status: "ok" }) : json(503, { status: "loading model" });
  if (pedido.url === "/v1/models") return json(200, { data: [{ id: "local" }] });
  if (pedido.url === "/v1/chat/completions" && pedido.method === "POST") {
    let corpo = "";
    pedido.on("data", (b) => (corpo += b));
    pedido.on("end", () => {
      const dados = JSON.parse(corpo);
      const conteudo = dados.messages.at(-1).content;
      const imagens = Array.isArray(conteudo) ? conteudo.filter((c) => c.type === "image_url").length : 0;
      anotar({ evento: "pedido", imagens, formato: dados.response_format?.type ?? null, imagemValida: Array.isArray(conteudo) ? conteudo.filter((c) => c.type === "image_url").every((c) => /^data:image\/(png|jpeg);base64,/.test(c.image_url.url)) : null });
      const texto = imagens
        ? { quadros: Array.from({ length: imagens }, (_, i) => ({ n: i + 1, elementos: ["carro", "pessoa"] })), cor: "vermelho" }
        : { humor: [1], resposta: "5" };
      json(200, { choices: [{ message: { role: "assistant", content: JSON.stringify(texto) } }] });
    });
    return undefined;
  }
  return json(404, { erro: "desconhecido" });
}).listen(porta, "127.0.0.1");
