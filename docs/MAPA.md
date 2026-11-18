# Mapa do código

Gerado em 18/11/2026 a partir do próprio código: importações, símbolos exportados e
tamanho de cada arquivo extraídos com o compilador do TypeScript (a mesma base que
ferramentas como o Serena usam para TypeScript). 102 arquivos de código, cerca de 14,8 mil
linhas. Atualize este mapa quando a estrutura mudar.

Orientado às próximas edições: **aplicativo .exe** (sem prompt), **tela de abertura** e
**atualização automática** a partir do repositório. Plano detalhado:
[superpowers/plans/2026-11-18-aplicativo-windows.md](superpowers/plans/2026-11-18-aplicativo-windows.md).

## 1. Camadas e tamanho

| Camada | Arquivos | Linhas | Papel |
|---|---|---|---|
| `src/dominio/` | 10 | 1.226 | Tipos e contratos, sem E/S |
| `src/infra/` | 6 | 729 | Banco, caminhos, configurações, credenciais, cópias, instância |
| `src/servicos/` | 14 | 2.357 | Regras de cada assunto (projetos, memória, aprendizado, timeline, IA local...) |
| `src/nucleo/` | 10 | 2.211 | `Aplicacao` (monta tudo), fluxo, tarefas, produção, edição, qualidade, feedback |
| `src/interface/` | 19 | 3.284 | Servidor local + rotas, página da janela (`web/`), linha de comando |
| `Pipeline/` | 18 | 3.192 | Ferramentas audiovisuais e agentes (FFmpeg, Whisper, Remotion, HyperFrames) |
| `scripts/` | 25 | 1.794 | Instalar, iniciar, parar, atualizar, backup, restaurar, verificadores |

**Dependências entre camadas** (número de importações):

```
interface ──6──▶ nucleo ──47──▶ servicos ──8──▶ infra
    │              │  ╲──18────────────────────▶ infra
    │              ╰──13──▶ Pipeline
    ╰──3──▶ infra, 1 ▶ servicos
todas ──▶ dominio (101 importações)
Pipeline ──1──▶ servicos   ⚠ montagem.ts → servicos/estilos.ts (viola a regra das camadas)
```

Pacotes externos importados pelo código: só `remotion`, `@remotion/bundler`,
`@remotion/renderer` e `react` (todos em `Pipeline/rendering/`). O resto é módulo nativo do
Node. HyperFrames, Python (Whisper, yt-dlp), FFmpeg e o motor da IA local são programas
externos.

## 2. Pontos de entrada

| Entrada | Arquivo | Quem chama |
|---|---|---|
| Janela (servidor local) | `src/interface/principal.ts` | `scripts/iniciar.mjs` (pelo atalho ou `npm run iniciar`) |
| Abertura com console invisível (Windows) | `scripts/lib/abrir-oculta.mjs` → `principal.ts` | `iniciar.mjs` |
| Linha de comando | `src/interface/cli.ts` | `npm run app`, instalador, atualizador, backup, restaurar |
| Instalação | `scripts/instalar.mjs` ← `windows/Instalar.ps1` | usuário |
| Atualização (Git) | `scripts/atualizar.mjs` | usuário |
| Testes | `tests/unidade/*.test.ts` | `npm test` |

## 3. Fluxos principais

**Abrir a aplicação (hoje)**

```
atalho → node scripts/iniciar.mjs
  → (Windows) PowerShell Start-Process oculto → abrir-oculta.mjs → principal.ts
  → (se não der sinal em 20 s) spawn direto de principal.ts
principal.ts → new Aplicacao(caminhosPadrao()) → iniciarServidor() → grava Dados/execucao.json
iniciar.mjs ← lê execucao.json → abre Edge/Chrome --app=http://127.0.0.1:porta/?t=sessão
```

**Aplicacao** (`src/nucleo/aplicacao.ts`, 403 linhas) monta, nesta ordem: caminhos →
configurações → banco (com migração e recuperação) → hardware/VRAM → IA local → tarefas →
serviços → produção, qualidade, edição, feedback, referências → fluxo.

**Analisar → planejar → montar → renderizar**

```
rotas.ts → fluxo.ts (tarefa em segundo plano, com %)
  → producao.analisarBrutos → Pipeline/ingestion/arquivos.ts + Pipeline/analysis/conteudo.ts
       (FFmpeg/FFprobe por Pipeline/analysis/ferramentas.ts; Whisper por Pipeline/transcription/)
  → producao.planejar → Pipeline/editing/planejamento.ts
  → edicao.montar → Pipeline/editing/montagem.ts (+ servicos/estilos ⚠)
  → edicao.exportar → Pipeline/rendering/motor.ts (Remotion) + hyperframes.ts
       → nucleo/qualidade.ts → Pipeline/quality-control/verificador.ts
```

**Atualizar (hoje)**: `scripts/atualizar.mjs` exige Git, cópia de segurança
"pre-atualizacao", `git merge --ff-only`, `configurar_ambiente.mjs` se as dependências
mudaram, abre a CLI para migrar o banco e volta atrás se falhar.

## 4. Onde cada próxima edição mexe

### 4.1 Aplicativo .exe (sem prompt)

| Ponto | Arquivo | Situação hoje | Muda para |
|---|---|---|---|
| Abrir sem janela de prompt | `scripts/iniciar.mjs`, `scripts/lib/abrir-oculta.mjs` | Node + PowerShell, janela de console minimizada | Processo do aplicativo (sem console) inicia o servidor com `windowsHide`; tudo o que ele abrir herda um console invisível |
| Janela | `iniciar.mjs` (`abrirJanela`, Edge/Chrome `--app`) | Depende do Edge ou do Chrome | Janela própria do aplicativo |
| Raiz do programa | `src/infra/caminhos.ts:30`, `Pipeline/rendering/motor.ts:19` | `import.meta.url` + "../.." | Continua valendo, desde que o código fique fora de pacote compactado (asar) |
| Arquivos gravados na pasta do programa | `config/local.aceleracao.json` (`aplicacao.ts:107`, `scripts/detectar_gpu.mjs`), `config/local.instalacao.json` (`caminhos.ts:53`) | Dentro da pasta do programa | Pasta de dados (a atualização substitui a pasta do programa) |
| Ambiente Python | `.venv` (`Pipeline/transcription/whisper.ts:24`, `scripts/lib/comum.mjs` `binVenv`) | Dentro da pasta do programa | Pasta de dados, por variável `IAEV_PYTHON` |
| FFmpeg, Python, Git | instalados pelo winget (`windows/Instalar.ps1`) | Exigem winget e terminal | Baixados na primeira abertura, com %, para a pasta de dados; Git deixa de ser necessário |
| Node.js | instalado pelo winget | Exige Node no sistema | O próprio executável do aplicativo roda como Node (`ELECTRON_RUN_AS_NODE`), a confirmar no Windows |

### 4.2 Tela de abertura

| Ponto | Arquivo | Situação hoje |
|---|---|---|
| Espera do servidor | `iniciar.mjs` (laço que lê `execucao.json`) | Texto no console |
| Primeira configuração | `scripts/configurar_ambiente.mjs` (5 partes, com %) | Só pelo instalador |
| Migração e cópia automática | `aplicacao.ts` (construtor) | Silenciosas; avisos em `app.avisos` |
| Componentes de progresso | `web/nucleo.js` (`barra`, `atualizarBarra`) | Na página principal; a tela de abertura reaproveita o estilo |

### 4.3 Atualização automática pelo repositório

| Ponto | Arquivo | Situação hoje |
|---|---|---|
| Atualizador | `scripts/atualizar.mjs` | Git, pasta do programa como clone |
| Cópia antes de atualizar | `src/interface/cli.ts` (`backup pre-atualizacao`), `src/infra/backup.ts` | Pronta para reaproveitar |
| Migração segura | `src/infra/banco.ts` (`MIGRACOES`, cópia "pre-migracao") | Pronta |
| Versão | `package.json` (`version`), `aplicacao.versao()` | 0.1.0, nunca incrementada |
| Publicação | — | Não existe pipeline de lançamento |

## 5. Dívidas estruturais encontradas

1. **Camada violada:** `Pipeline/editing/montagem.ts` importa `src/servicos/estilos.ts`.
   O tipo do estilo deveria vir de `src/dominio/` (mover a interface `EstiloDeEdicao`).
2. **Busca de navegador repetida** em quatro lugares: `Pipeline/rendering/motor.ts`
   (`chromeDoSistema`), `Pipeline/rendering/hyperframes.ts` (`navegadorDoRemotion`,
   `navegadorDoSistema`), `scripts/lib/comum.mjs` (`chromeDoSistema`, `navegadorDoRemotion`)
   e `scripts/iniciar.mjs`. Unificar em `Pipeline/rendering/navegadores.ts` (o código de
   `scripts/` só pode usar módulos nativos, então a versão `.mjs` fica como espelho).
3. **Estado de máquina na pasta do programa** (seção 4.1): impede atualizar trocando a pasta.
4. **Arquivos grandes** que concentram muitas responsabilidades: `src/interface/rotas.ts`
   (554), `src/interface/cli.ts` (544), `src/servicos/ia-local.ts` (545). Dividir quando a
   próxima edição precisar mexer neles (rotas por assunto; CLI por comando; IA local em
   download, motor e provedor).
5. **Versão fixa em 0.1.0**: a atualização automática compara versões, então cada
   lançamento precisa incrementar `package.json`.

## 6. Mapa de arquivos por responsabilidade

| Assunto | Arquivos |
|---|---|
| Ciclo de vida | `src/nucleo/aplicacao.ts`, `src/infra/instancia.ts`, `src/interface/principal.ts`, `scripts/iniciar.mjs`, `scripts/parar.mjs` |
| Servidor e janela | `src/interface/servidor.ts`, `rotas.ts`, `sistema.ts`, `web/app.js`, `web/nucleo.js`, `web/telas/*.js` |
| Projetos e fluxo | `src/servicos/projetos.ts`, `atividades.ts`, `src/nucleo/fluxo.ts`, `tarefas.ts` |
| Análise | `Pipeline/ingestion/arquivos.ts`, `Pipeline/analysis/*.ts`, `src/nucleo/referencias.ts`, `transcricao.ts`, `Pipeline/transcription/*` |
| Plano e roteiro | `src/nucleo/producao.ts`, `Pipeline/editing/planejamento.ts`, `roteiro.ts` |
| Edição e render | `src/nucleo/edicao.ts`, `src/servicos/timeline.ts`, `estilos.ts`, `Pipeline/editing/montagem.ts`, `Pipeline/rendering/*` |
| Qualidade | `src/nucleo/qualidade.ts`, `src/servicos/qualidade.ts`, `Pipeline/quality-control/verificador.ts`, `IA/Qualidade/`, `IA/Exportacao/` |
| Memória e aprendizado | `src/servicos/memoria.ts`, `aprendizado.ts`, `acervo.ts`, `indice.ts`, `src/nucleo/feedback.ts`, `src/servicos/comparacao.ts` |
| IA | `src/servicos/provedores.ts`, `ia-local.ts`, `src/infra/credenciais.ts`, `IA/Local/` |
| Dados e proteção | `src/infra/banco.ts`, `backup.ts`, `caminhos.ts`, `configuracoes.ts` |
| Instalação e manutenção | `scripts/instalar.mjs`, `atualizar.mjs`, `backup.mjs`, `restaurar.mjs`, `configurar_ambiente.mjs`, `detectar_gpu.mjs`, `scripts/verificar/*`, `windows/*` |
