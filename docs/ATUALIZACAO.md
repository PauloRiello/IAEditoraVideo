# Guia de atualização

Atualizar troca só o programa. Projetos, banco de dados, referências, preferências,
perfis, aprendizados e exportações ficam em pastas separadas e não são tocados.

## Como atualizar

No Windows, dê dois cliques em **`windows\Atualizar.cmd`**. Nos demais sistemas:

```bash
npm run atualizar
```

## O que a atualização faz

| Passo | O que acontece |
|---|---|
| 1 | Confere se a pasta do programa não tem arquivos alterados à mão. Se tiver, para e explica |
| 2 | Consulta o GitHub. Sem versão nova, avisa e termina |
| 3 | Encerra a aplicação, se estiver aberta |
| 4 | Cria uma cópia de segurança marcada como "antes de atualizar o programa" |
| 5 | Traz o código novo pelo Git |
| 6 | Instala dependências, só se a nova versão mudou alguma |
| 7 | Abre a aplicação uma vez para atualizar o banco. Antes de mudar o banco, a aplicação cria outra cópia própria |
| 8 | Reabre a aplicação, se ela estava aberta |

Se a nova versão não instalar ou não abrir, o programa **volta sozinho à versão anterior**,
os dados são devolvidos ao estado da cópia do passo 4 e a mensagem diz o que aconteceu.

## Por que os dados não se perdem

- **Separação.** O Git só controla a pasta do programa. O banco, as configurações, os
  perfis personalizados, as cópias de segurança e as chaves ficam na pasta de dados; os
  vídeos e as exportações, na pasta de vídeos. As pastas escolhidas na instalação ficam em
  `config/local.instalacao.json`, que o Git ignora.
- **Migrações.** O banco evolui por migrações numeradas. Uma versão nova aplica só as que
  faltam, dentro de uma transação, depois de criar uma cópia.
- **Configurações.** Opções novas recebem o valor padrão; as suas continuam como estavam.
- **Personalizações.** Perfis, estilos, destinos de qualidade e presets criados por você
  ficam na pasta de dados e prevalecem sobre os que vêm com o programa.

## Situações especiais

| Situação | O que fazer |
|---|---|
| "esta instalação não veio do Git" | A pasta veio de um ZIP. Baixe o ZIP da nova versão, extraia sobre a mesma pasta e execute o instalador de novo. Os dados são preservados |
| "há arquivos do programa alterados nesta pasta" | Desfaça as alterações ou guarde-as em outro lugar. Personalizações devem ficar na pasta de dados |
| "não foi possível consultar o GitHub" | Confira a internet e tente de novo |
| Voltar a uma versão anterior por conta própria | Restaure a cópia "antes de atualizar o programa" ([BACKUP.md](BACKUP.md)) e use o Git para voltar o código |

Um banco atualizado por uma versão nova não abre em uma versão antiga do programa: a
aplicação avisa e pede a atualização, em vez de arriscar os dados.
