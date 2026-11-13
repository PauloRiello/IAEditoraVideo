# Memória persistente e aprendizado

A memória é propriedade da aplicação: fica em um banco SQLite local, sobrevive a
fechamentos, reinicializações e atualizações, e não depende de histórico de conversa,
de agentes externos nem de qualquer serviço de IA.

Exemplo executável, em pasta temporária: `npm run exemplo:memoria`
(código em [`exemplos/memoria.ts`](../exemplos/memoria.ts)).

## 1. O que é guardado e onde

| Conteúdo | Onde | Serviço |
|---|---|---|
| Projetos e mídias (caminhos e metadados) | tabelas `projetos`, `midias` | `app.projetos` |
| Referências e vínculo com projetos | `referencias`, `projeto_referencias` | `app.acervo` |
| Análises de vídeos e de referências | `analises` | `app.acervo` |
| Planos de edição e histórico de versões | `planos` | `app.acervo` |
| Feedbacks | `feedback` | `app.aprendizado` |
| Aprendizados e suas evidências | `aprendizados`, `evidencias` | `app.aprendizado` |
| Preferências e fatos por escopo | `memoria` | `app.memoria` |
| Modelos e provedores utilizados | `usos_ia` | `app.acervo` |
| Execuções do pipeline | `execucoes` | `app.orquestrador` |
| Perfis de estilo | arquivos JSON em `IA/Perfis/` e `Dados/perfis/` | `app.perfis` |
| Configurações | `Dados/config/configuracoes.json` | `app.configuracoes` |

- **Vídeos nunca entram no banco.** Guardam-se caminhos, metadados e resultados de
  análise; um teste confere que o esquema não tem nenhuma coluna binária.
- **Configurações ficam em arquivo JSON**, não no banco, porque precisam ser lidas antes
  de o banco abrir e poder ser editadas à mão. Elas entram nas cópias de segurança.
- **Perfis são arquivos**: os do programa em `IA/Perfis/`, os do usuário em
  `Dados/perfis/` (prevalecem sobre os do programa quando o id coincide). O estilo
  aprendido de cada perfil fica na tabela `aprendizados`.

## 2. Categorias da memória de edição

Todo aprendizado pertence a uma destas 18 categorias (`CATEGORIAS_EDICAO`):

`ritmo`, `cortes`, `duracao-planos`, `transicoes`, `movimentos-camera`, `zoom`,
`efeitos-visuais`, `cores`, `iluminacao`, `tipografia`, `legendas`, `trilha-sonora`,
`efeitos-sonoros`, `sincronizacao-musical`, `narrativa`, `hooks`, `retencao`, `cta`.

Dentro da categoria, a `chave` identifica o assunto (por exemplo `ritmo` /
`cortes-por-minuto`) e o `valor` guarda o dado estruturado.

## 3. Perfis de especialização

Perfis incluídos: `geral`, `fivem`, `redm`, `redes-sociais`, `publicidade`,
`institucional`, `documentario`, `youtube`. Para criar outro, acrescente um arquivo JSON
com o mesmo formato em `Dados/perfis/`.

**Combinação.** Um projeto usa o seu perfil; outros podem ser somados a pedido:

```ts
app.perfis.combinar(["fivem", "redes-sociais"]);          // formatos e diretrizes
app.aprendizadosDoProjeto(projetoId, ["redes-sociais"]);   // aprendizados
```

Quando dois perfis têm aprendizados com valores diferentes para o mesmo assunto, nenhum
é aplicado: o caso volta em `conflitos`, com as opções, para alguém decidir. Para
resolver pela ordem dos perfis, passe `true` no terceiro argumento — o primeiro prevalece.

## 4. Aprendizado controlado

Cada aprendizado registra:

| Informação | Campo |
|---|---|
| O que foi aprendido | `descricao`, `valor` |
| De onde veio | `evidencias[].origem`: `correcao`, `feedback`, `analise` ou `usuario` |
| Em qual projeto foi observado | `evidencias[].projetoId` |
| Quantas evidências existem | `evidencias`, `contrarias`, `projetosObservados` |
| Grau de confiança | `confianca`, de 0 a 1 |
| Contexto de aplicação | `contexto` |
| Datas | `criadoEm`, `atualizadoEm` |

### Escopos

| Escopo | Vale para | Passa a ser aplicado quando |
|---|---|---|
| `temporaria` | Um projeto (ou todos), com validade opcional | Imediatamente; some ao expirar |
| `projeto` | Um único projeto | Imediatamente |
| `especializacao` | Projetos de um perfil | Observado em 2 projetos distintos |
| `geral` | Todos os projetos | Observado em 3 projetos distintos |

Uma instrução explícita do usuário (`origem: "usuario"`) vale na hora em qualquer escopo.
Na consulta prevalece o mais específico: temporária > projeto > especialização > geral.

### Por que uma correção isolada não vira regra

`registrarCorrecao(projetoId, ...)` faz duas coisas: aplica a correção ao projeto e a
registra como **candidata** no perfil dele. A candidata não é usada em outros projetos.
Só quando a mesma correção aparece em um segundo projeto do perfil ela é promovida. Por
esse caminho ela nunca chega ao escopo geral.

### Confiança

`confiança = favoráveis ÷ (favoráveis + contrárias + 2)`, com peso 1 por observação e 3
por instrução explícita. Uma observação dá 0,33; duas, 0,5; três, 0,6. Observar um valor
diferente para o mesmo assunto conta como evidência contrária ao anterior. Quando as
contrárias alcançam as favoráveis, o aprendizado volta a candidato.

### Revisão

| Operação | Chamada | Linha de comando |
|---|---|---|
| Listar e filtrar | `aprendizado.listar({ estado, perfil, categoria })` | `npm run app -- aprendizados [estado]` |
| Ver a origem | `aprendizado.evidencias(id)` | — |
| Corrigir | `aprendizado.corrigir(id, { descricao, valor, contexto })` | — |
| Desativar | `aprendizado.desativar(id)` | `npm run app -- aprendizado desativar <id>` |
| Ativar por decisão própria | `aprendizado.ativar(id)` | `npm run app -- aprendizado ativar <id>` |
| Excluir | `aprendizado.excluir(id)` | `npm run app -- aprendizado excluir <id>` |

Um aprendizado desativado continua guardado e não volta a ser aplicado por novas
evidências; só por `ativar`.

## 5. Uso no código

```ts
import { Aplicacao } from "./src/nucleo/aplicacao.ts";

const app = new Aplicacao();
const projeto = app.criarProjeto("Divulgação do servidor", "fivem");

// Correção feita pelo usuário neste projeto
app.aprendizado.registrarCorrecao(projeto.id, {
  categoria: "ritmo", chave: "cortes-por-minuto",
  descricao: "Cortes mais rápidos, cerca de 40 por minuto", valor: 40,
});

// Instrução explícita para o perfil inteiro
app.aprendizado.observar({
  escopo: "especializacao", perfil: "fivem", categoria: "cta", chave: "encerramento",
  descricao: "Terminar com o endereço do Discord na tela", valor: "discord", origem: "usuario",
});

// O que a edição deve respeitar neste projeto
const { aplicaveis, conflitos } = app.aprendizadosDoProjeto(projeto.id);

// Plano de edição versionado
app.acervo.salvarPlano(projeto.id, plano, "ia", "Primeira proposta");
app.acervo.restaurarPlano(projeto.id, 1);

app.encerrar();
```

## 6. Persistência e segurança

| Proteção | Como funciona |
|---|---|
| Salvamento automático | Não existe "salvar": cada operação é gravada em disco na hora (SQLite em modo WAL com `synchronous = FULL`). Operações compostas usam transação: ou tudo é gravado, ou nada |
| Cópia de segurança | `app.copiaDeSeguranca()` ou `npm run app -- backup`. Cada cópia é uma pasta em `Dados/backups/` com o banco e as configurações, criada mesmo com a aplicação em uso |
| Cópia automática | Ao abrir, se a última cópia tiver mais de 24 h. São mantidas as 10 automáticas mais recentes; cópias manuais nunca são apagadas. Ajustável em `backup` nas configurações |
| Restauração | `app.restaurar(nome)` ou `npm run app -- backup restaurar <nome>`. A cópia é validada antes; o estado atual é guardado em uma cópia `pre-restauracao`, o que torna a operação reversível |
| Migrações | O esquema evolui por migrações numeradas. Antes de migrar um banco com dados, é criada uma cópia `pre-migracao` |
| Banco corrompido | O arquivo danificado é renomeado (`.corrompido-<data>`), nunca apagado, e a cópia válida mais recente é restaurada. Sem cópias, a aplicação abre com um banco novo. O usuário é avisado em `app.avisos` |
| Configurações ilegíveis | O arquivo é preservado à parte e os valores padrão são usados |
| Fechamento à força | Etapas que ficaram "executando" são marcadas como falhas na abertura seguinte |
| Dados fora do GitHub | Tudo fica em `Dados/` (ou em `%LOCALAPPDATA%` no programa instalado), pasta ignorada pelo Git |

## 7. Limites desta etapa

- Os aprendizados são registrados e consultados, mas ainda não há motor de edição que os aplique.
- Nada extrai aprendizados automaticamente de feedbacks em texto ou de análises: quem
  chama `observar` e `registrarCorrecao` serão as etapas futuras e a interface.
- A cópia de segurança cobre banco e configurações, não as mídias nem os perfis do usuário.
