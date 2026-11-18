# Guia de cópia de segurança e restauração

## O que entra na cópia

| Entra | Não entra |
|---|---|
| Banco de dados: projetos, análises, planos, timelines, exportações registradas, avaliações e aprendizados | Vídeos brutos, referências e exportações (arquivos grandes, na sua pasta de vídeos) |
| Configurações da aplicação | Chaves de API de provedores externos |
| Perfis, estilos, destinos de qualidade e presets criados por você | Arquivos temporários, prévias e miniaturas (são refeitos) |

Para proteger também os vídeos, copie por conta própria as pastas `Videos Brutos`,
`Referências` e `Exportações`. O comando de cópia mostra onde elas estão.

## Cópias automáticas

- Ao abrir, a aplicação cria uma cópia se a última tiver mais de 24 horas. São mantidas
  as 10 automáticas mais recentes (ajustável em **Configurações**).
- Antes de atualizar o banco, antes de atualizar o programa e antes de qualquer
  restauração, uma cópia é criada sozinha. Essas cópias e as manuais nunca são apagadas
  pela aplicação.

## Criar uma cópia

Na janela: **Configurações → Cópias de segurança → Criar cópia agora**.

Fora da janela, com a aplicação aberta ou fechada: `windows\Backup.cmd`, ou

```bash
npm run backup
```

Para copiar também para outro disco (pen drive, HD externo, pasta de nuvem):

```bash
npm run backup -- --destino "E:\Backups"
```

Para listar as cópias:

```bash
npm run backup -- --listar
```

As cópias ficam na pasta de dados, em `backups`, uma pasta por cópia, com a data no nome.

## Restaurar

Na janela: **Configurações → Cópias de segurança → Restaurar**, na linha da cópia.

Fora da janela: `windows\Restaurar.cmd`, que mostra as cópias e pergunta qual, ou

```bash
npm run restaurar
```

Para restaurar direto uma cópia pelo nome, ou uma cópia guardada em outro disco:

```bash
npm run restaurar -- "E:\Backups\2026-11-14T06-32-46-778Z_manual" --sim
```

O que acontece na restauração:

1. A cópia é conferida. Uma cópia danificada, ou criada por uma versão mais nova do
   programa, é recusada e nada muda.
2. O estado atual é guardado em uma cópia "antes de uma restauração". Para desfazer a
   restauração, restaure essa cópia.
3. O banco, as configurações e os perfis personalizados voltam ao estado da cópia.
4. Os vídeos não são alterados. Projetos restaurados continuam apontando para os mesmos arquivos.

## Mudar de computador

1. No computador antigo, crie uma cópia com `--destino` em um disco externo e copie as
   pastas de vídeos.
2. No computador novo, instale a aplicação ([INSTALACAO.md](INSTALACAO.md)).
3. Copie os vídeos para a **mesma pasta** (mesma letra de disco e caminho), porque os
   projetos guardam o caminho dos arquivos.
4. Restaure a cópia e informe de novo as chaves de API, se usava provedores externos.

## Proteções contra perda de dados

- Cada gravação no banco vai para o disco na hora.
- Um banco corrompido é afastado (não apagado) e a cópia válida mais recente é restaurada
  ao abrir.
- Um arquivo de configurações ilegível é afastado e os valores padrão são usados.

Detalhes em [MEMORIA.md](MEMORIA.md).
