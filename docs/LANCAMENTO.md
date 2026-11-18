# Lançar uma versão

O programa instalado se atualiza sozinho a partir dos lançamentos publicados no GitHub
(`PauloRiello/IAEditoraVideo`, aba Releases). Um lançamento é gerado pelo fluxo
[`.github/workflows/lancamento.yml`](../.github/workflows/lancamento.yml), num Windows de verdade.

> O atualizador baixa sem login, então o repositório precisa ser **público**. Enquanto for
> privado, o programa instalado só registra que não conseguiu procurar atualizações.

## Passo a passo

1. Confira que `npm run typecheck` e `npm test` passam no ramo principal.
2. Suba a versão e crie a etiqueta (escolha `patch` para correções, `minor` para novidades):

   ```bash
   npm version minor
   ```

3. Envie o commit e a etiqueta:

   ```bash
   git push --follow-tags
   ```

4. Acompanhe o fluxo "Lançamento" na aba Actions. Ele:
   1. instala as dependências e confere os tipos;
   2. confere se a etiqueta (`v0.2.0`) é igual à versão do `package.json`;
   3. gera o instalador (`IA-Editora-de-Video-Setup-<versão>.exe`);
   4. instala em silêncio, como um usuário faria;
   5. abre o programa instalado com `--teste-de-fumaca`: ele prepara o computador, inicia o
      servidor, confere `/api/saude` e `/api/painel` e fecha;
   6. só se tudo passou, publica o lançamento com o instalador, o `latest.yml` e o `.blockmap`
      (usados pela atualização automática).

Nos pedidos de integração (pull requests) e na execução manual, os passos 1 a 5 rodam e o
instalador fica disponível como artefato do fluxo ("instalador-windows"), sem publicar nada.

## Se falhar

- **"A etiqueta não confere com a versão"**: a etiqueta foi criada à mão. Apague-a
  (`git push --delete origin v0.2.0` e `git tag -d v0.2.0`) e use `npm version`.
- **"O programa instalado não abriu"**: o passo "Registro do programa" mostra as últimas
  linhas de `aplicativo.log`. O lançamento não é publicado; corrija e crie uma nova versão.
- **Lançamento publicado com defeito**: publique logo uma versão corrigida (o atualizador
  sempre pega a mais nova). Não apague o lançamento com defeito antes disso: quem já baixou
  precisa de um lançamento mais novo para sair dele.

## O que os usuários veem

- Primeira instalação: baixam o `Setup.exe` do lançamento e executam. Não há assinatura
  digital, então o Windows pode mostrar "O Windows protegeu o computador"; clique em
  "Mais informações" e "Executar assim mesmo".
- Atualizações: o programa procura ao abrir e a cada 6 horas, baixa em segundo plano e
  instala ao fechar (ou em Configurações → Sobre → "Reiniciar e atualizar"), sempre depois
  de uma cópia de segurança e nunca durante uma análise ou um render.
