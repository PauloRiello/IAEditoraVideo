# IA Editora de Vídeo — orientações de desenvolvimento

Aplicação de edição inteligente de vídeo, independente e instalável no Windows.
Leia [docs/ARQUITETURA.md](docs/ARQUITETURA.md) antes de alterar a estrutura e
[docs/PROGRESSO.md](docs/PROGRESSO.md) para saber em que etapa o projeto está.

## Regras obrigatórias

- **O produto é independente do Claude.** Claude Code é só ferramenta de desenvolvimento.
  O código em `src/` e `Pipeline/` não pode depender de Claude Code, Claude Desktop,
  sessões de agentes, histórico de conversa nem da API da Anthropic. `npm test` falha
  se `src/` mencionar Claude ou Anthropic.
- **Nenhuma API de IA é obrigatória.** IA entra só pela camada de provedores
  (`src/servicos/provedores.ts`). Sem provedor, a aplicação abre e as operações locais funcionam.
- **Local primeiro.** Não presuma GPU: consulte `GerenciadorVram` e tenha caminho por CPU.
- **Respeite as camadas.** Interface → núcleo → serviços → infraestrutura. Só
  `src/infra/banco.ts` contém SQL de esquema. Ferramentas audiovisuais só em `Pipeline/`.
- **Dados do usuário são sagrados.** Nunca altere mídias originais. Mudança de esquema
  é sempre uma migração nova ao final de `MIGRACOES`, nunca a edição de uma existente.
- **Aprendizado é controlado.** Registre aprendizados por `observar` ou `registrarCorrecao`
  (`src/servicos/aprendizado.ts`); nunca grave uma regra geral a partir de um único caso.
  As regras estão em [docs/MEMORIA.md](docs/MEMORIA.md).
- **A memória do produto é o banco local.** Nada do que a aplicação precisa lembrar pode
  ficar em arquivos de sessão ou de memória do Claude.
- **Observado não é estimado.** Em análises, tudo o que não for medição direta do arquivo
  é marcado como `estimado`, e o que não puder ser avaliado como `nao-avaliado`, nunca
  preenchido por suposição (`src/dominio/analise.ts`, [docs/REFERENCIAS.md](docs/REFERENCIAS.md)).
- **Referência ensina princípio, não cópia.** Regras vindas de referências usam faixas
  qualitativas e entram na memória como candidatas.
- **Nada inventado.** Plano e roteiro só usam o que está no briefing ou no material: sem
  CTA informado não há CTA; linha de roteiro sem fato de apoio é descartada
  ([docs/PRODUCAO.md](docs/PRODUCAO.md)).
- **A edição espera a aprovação.** Nenhuma etapa de render roda sem o plano atual aprovado
  (`producao.exigirPlanoAprovado`).
- **"Agente" é componente do produto.** Os agentes de Arquivos, Conteúdo, Planejamento,
  Roteiro e Coordenador são classes da aplicação; não use agentes de programação nem
  serviços externos para cumprir o papel deles.
- **Um só motor de composição.** O Remotion compõe e codifica. O FFmpeg só prepara trechos e
  o HyperFrames só gera cartões que entram como trechos. Não crie outro caminho de render
  ([docs/EDICAO.md](docs/EDICAO.md)).
- **Edição não destrutiva.** A timeline muda só por `aplicarOperacao`, que devolve uma
  timeline nova; cada alteração vira uma versão. Render grava em temporário e só move
  para o destino ao terminar.
- **Efeito precisa de motivo.** A montagem só aplica um recurso que o estilo, a memória ou
  as referências pedem e que faz sentido no formato, e registra a origem da escolha.
- **Obrigatória reprovada não passa.** Vídeo com falha em verificação obrigatória nunca é
  aprovado nem entra em `Exportações/`, e essa falha não pode ser aceita como exceção. Só
  problemas não críticos são aceitos, pelo usuário, com justificativa
  ([docs/QUALIDADE.md](docs/QUALIDADE.md)).
- **Conferência independente.** O arquivo exportado é conferido com FFmpeg e FFprobe,
  nunca pelo que o renderizador informa. Verificação estimada é marcada como `estimado` e
  nunca é obrigatória.
- **Critério depende do destino.** Regras de redes sociais ficam no perfil `redes-sociais`;
  limite novo entra no JSON do destino (`IA/Qualidade/`), não no código do verificador.
- **Exportação não sobrescreve.** O arquivo é conferido fora de `Exportações/` e só então
  movido, com nome único.
- **A janela não decide nada.** `src/interface/rotas.ts` só traduz pedidos em chamadas à
  `Aplicacao`; a página em `src/interface/web/` só mostra e pede. Regra de negócio fica no
  núcleo e nos serviços. A interface não importa nada de `Pipeline/`.
- **Interface sem dependências.** A página é HTML, CSS e JavaScript puros, sem etapa de
  compilação; o servidor usa só módulos nativos do Node. Scripts carregados só da própria
  aplicação (a política de segurança da página bloqueia o resto).
- **Só o próprio computador.** O servidor atende apenas `127.0.0.1`, confere a origem e
  exige a sessão. Arquivos são servidos por identificador (projeto, mídia, exportação),
  nunca por caminho recebido no pedido.
- **Chave nunca aparece.** Chaves de API ficam só em `credenciais.json`, na pasta de
  dados. Não vão para respostas da API, configurações, registros, cópias de segurança,
  testes com valores reais nem commits.
- **Uma instância por pasta de dados.** Quem abre a `Aplicacao` com outra já aberta não
  recupera nem apaga trabalho em andamento (`src/infra/instancia.ts`).
- **Instalação e atualização preservam dados.** Scripts de `scripts/` e `windows/` nunca
  apagam nem sobrescrevem dados do usuário; a atualização faz cópia antes e volta atrás se
  falhar. Mensagens de erro dizem o que aconteceu e o que fazer, sem jargão.
- **Ferramenta opcional não trava o trabalho.** Placa de vídeo, bibliotecas CUDA e o
  navegador do HyperFrames podem não funcionar no computador do usuário. Sempre há caminho
  alternativo (processador; outro navegador; cartão desenhado pelo Remotion), e a troca é
  registrada. Ter o driver não prova que a placa funciona: confira carregando as bibliotecas
  (`Pipeline/transcription/gpu.py`).
- **IA local é modelo aberto, operado pela aplicação.** Motor e modelos têm versão, tamanho e
  SHA-256 fixados em `IA/Local/`; arquivo que não confere é descartado. Só modelos com
  licença que permite uso comercial. O motor só atende `127.0.0.1`, liga sob demanda,
  reserva a placa pelo `GerenciadorVram` e desliga sem uso. Nada é baixado sem pedido do
  usuário. O que o modelo interpreta é sempre `estimado`.
- **Feedback ensina com cautela.** Correção de um projeto fica candidata no perfil; rejeição
  sem aspecto apontado não ensina nada; métricas são sinal fraco, nunca criam regra e nunca
  são inventadas ([docs/FEEDBACK.md](docs/FEEDBACK.md)).
- **Aprendizado rastreável e reversível.** Toda evidência registra a fonte (projeto,
  referência, avaliação ou resultado). Ações sobre aprendizados passam por
  `ServicoAprendizado`, que guarda o estado anterior para desfazer.
- **Nada pessoal no Git.** Vídeos, banco, `Dados/`, `.env` e chaves ficam fora.
- **Trabalhe uma etapa por vez** e não avance para a seguinte sem autorização do usuário.

## Comandos

| Comando | Função |
|---|---|
| `npm run instalar` | Instalação completa: pastas, dependências, verificação, banco e atalho |
| `npm run iniciar` / `npm run parar` | Abre a aplicação com a janela / encerra com segurança |
| `npm run atualizar` | Atualiza pelo Git, com cópia de segurança e reversão em caso de falha |
| `npm run backup` / `npm run restaurar` | Cria / restaura cópia de segurança |
| `npm run setup` | Instala o que falta (npm, `.venv`, GPU, navegador de render) |
| `npm test` | Testes de unidade da aplicação |
| `npm run typecheck` | Checagem de tipos |
| `npm run verificar` | 12 verificações das ferramentas instaladas |
| `npm run app -- situacao` | Executa a aplicação pela linha de comando |
| `npm run exemplo:memoria` | Demonstra memória e aprendizado em pasta temporária |
| `npm run versoes` | Regrava `docs/VERSOES.md` |

Antes de concluir uma alteração: `npm run typecheck` e `npm test`.

## Convenções de código

- TypeScript executado direto pelo Node 22, sem compilação. Por isso: importações com
  extensão `.ts`, `import type` para tipos, e nada de `enum`, `namespace` ou
  propriedades declaradas nos parâmetros do construtor.
- Nomes e comentários em português. Nomes das etapas do pipeline em inglês, iguais às pastas.
- Sem dependências novas de produção sem justificativa registrada em `docs/ARQUITETURA.md`.
- Scripts de ambiente em `scripts/` usam só módulos nativos do Node e devem rodar em
  Windows, macOS e Linux.

## Onde fica cada coisa

| Pasta | Conteúdo |
|---|---|
| `src/dominio/` | Tipos e contratos, sem E/S |
| `src/nucleo/` | `Aplicacao` (ciclo de vida), `Orquestrador` (pipeline), análise de referências, Agente Coordenador (`producao.ts`), edição e exportação (`edicao.ts`), relatórios de qualidade e exceções (`qualidade.ts`), feedback e métricas (`feedback.ts`), fluxo de trabalho da janela (`fluxo.ts`), tarefas em segundo plano (`tarefas.ts`) |
| `src/servicos/` | Projetos, memória, aprendizado, acervo, índice de pesquisa, timeline, comparação de versões, estilos, perfis, perfis de qualidade e presets, atividades, provedores de IA, IA local, recursos |
| `src/infra/` | Banco SQLite, cópias de segurança, caminhos, configurações, credenciais, instância em execução |
| `src/interface/` | Servidor local (`servidor.ts`), rotas (`rotas.ts`), ponto de entrada da janela (`principal.ts`), linha de comando (`cli.ts`) |
| `src/interface/web/` | Página da janela: `app.js`, `nucleo.js`, `estilo.css` e uma tela por arquivo em `telas/` |
| `Pipeline/<etapa>/` | Processamento audiovisual e agentes (as seis etapas têm código; `quality-control/` é o Agente de Qualidade) |
| `IA/Perfis/` | Perfis de especialização em JSON (9 perfis) |
| `IA/Estilos/` | Estilos de edição em JSON (10 estilos) |
| `IA/Qualidade/` | Perfis de qualidade por destino em JSON (6 destinos) |
| `IA/Exportacao/` | Presets de exportação em JSON (7 presets) |
| `IA/Local/` | Motor (llama.cpp) e modelos (Qwen3-VL) da IA local, com versão, tamanho e SHA-256 fixados |
| `exemplos/` | Exemplos executáveis de uso da aplicação |
| `tests/unidade/` | Testes da aplicação (referências, produção, edição, qualidade e interface geram vídeos com o FFmpeg e renderizam de verdade; `ciclo.test.ts` instala, abre, atualiza e restaura uma cópia do programa em pasta temporária; a suíte leva cerca de 2 min) |
| `tests/smoke/` | Composições mínimas usadas pelos verificadores |
| `tests/windows/` | Simulação do instalador do Windows com PowerShell fora do Windows (`bash tests/windows/simular_instalador.sh`; exige `pwsh`, senão é pulada) |
| `scripts/` | Instalar, iniciar, parar, atualizar, backup, restaurar, setup, detecção de GPU e verificadores |
| `windows/` | Instalador (`Instalar.cmd`, `Instalar.ps1`) e atalhos `.cmd`, em ASCII e com fim de linha do Windows |
| `Dados/` | Banco, configurações e temporários locais (fora do Git) |

## Ao terminar uma etapa

Atualize `README.md`, `docs/ARQUITETURA.md` se a estrutura mudou, os guias do usuário
(`docs/INSTALACAO.md`, `USO.md`, `ATUALIZACAO.md`, `BACKUP.md`, `LIMITACOES.md`) se o que
o usuário vê mudou, e acrescente a etapa em `docs/PROGRESSO.md` com o que foi feito, os
testes e as pendências.

Ao mexer na janela, confira no navegador de verdade: os testes de `interface.test.ts`
cobrem a API, não a página. Ao mexer em `windows/` ou em `scripts/instalar.mjs`, rode a
simulação de `tests/windows/` e mantenha os arquivos de `windows/` em ASCII, compatíveis
com o Windows PowerShell 5.1.
