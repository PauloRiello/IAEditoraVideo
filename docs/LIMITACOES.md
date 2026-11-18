# Limitações conhecidas

Situação da primeira versão utilizável (0.1.0). Nada aqui é escondido pela aplicação: o
que não foi avaliado aparece como "não avaliado", nunca como um palpite.

## Instalação e sistema

- **Windows testado só em parte.** A aplicação é desenvolvida e testada em Linux. O
  instalador rodou uma vez em um Windows 11 real (Node.js 26, Python 3.14, RTX 3050):
  winget, dependências, detecção da placa, render pelo Remotion com NVENC, banco e atalho
  funcionaram. Duas verificações falharam e foram corrigidas: o Whisper não achava as
  bibliotecas CUDA (agora são conferidas e instaladas, e a transcrição cai para o
  processador se a placa não puder ser usada) e o navegador do HyperFrames não abriu
  (agora há navegadores alternativos e, por fim, o cartão desenhado pelo Remotion). Essas
  correções foram testadas em Linux, simulando as falhas, mas **ainda não conferidas no
  Windows**. Também faltam testar no Windows: abrir pelo atalho, a janela no Edge, o uso
  da aplicação, atualizar, copiar e restaurar.
- **Causa do erro do HyperFrames no Windows não identificada.** A mensagem foi "Invalid
  file descriptor to ICU data received", do navegador próprio dele. A aplicação contorna
  o problema, mas não o elimina. O `hyperframes doctor` não aponta a causa (ele não abre o
  navegador). Uma pista não confirmada: o computador do teste tinha só 1,2 GB de memória
  livre de 15,7 GB, mas o erro continuou depois de fechar os outros programas, então a
  memória provavelmente não é a causa. A pista que resta: o Node.js 26, mais novo que o 22
  usado no desenvolvimento.
- **Instalador sem assinatura digital.** Na primeira vez, o Windows mostra "O Windows
  protegeu o computador"; é preciso clicar em "Mais informações → Executar assim mesmo".
  Assinar exige um certificado pago.
- **A atualização automática exige o repositório público.** O atualizador baixa os
  lançamentos sem login. Enquanto o repositório for privado, o programa só registra que não
  conseguiu procurar atualizações.
- **O instalador só é gerado num Windows.** Os componentes nativos (como o compositor do
  Remotion) dependem do sistema onde as dependências são instaladas; o fluxo "Lançamento"
  do GitHub faz isso num Windows. `npm run empacotar` em Linux gera um programa que não
  renderiza no Windows.
- **Pasta de vídeos personalizada da instalação antiga.** O aplicativo reaproveita a pasta
  padrão do `Instalar.cmd` (`Documentos\IA Editora de Video`, inclusive no OneDrive); quem
  escolheu outra pasta lá precisa apontá-la de novo (ela fica em
  `%LOCALAPPDATA%\IAEditoraVideo\aplicativo.json`).
- **Links do YouTube sem Node.js.** O yt-dlp usa o Node.js para parte do YouTube. No
  aplicativo, que não exige Node instalado, baixar referências do YouTube pode falhar.
- **Primeiro render baixa o navegador de render.** A preparação não baixa o navegador do
  Remotion; ele vem no primeiro render, que demora mais e não mostra a porcentagem desse
  download. Fica guardado na pasta do ambiente e não é baixado de novo nas atualizações.
- **Pelo código-fonte:** o `Instalar.cmd` usa o winget para instalar Node.js, Git, FFmpeg
  e Python, abre a página numa janela do Edge ou do Chrome e atualiza pelo Git.
- **Codificação por GPU (NVENC) testada só na verificação.** Em um Windows com RTX 3050, o
  render de teste do Remotion usou NVENC. Uma exportação completa pela GPU ainda não foi
  conferida. Sem GPU, tudo roda pelo processador.

## Andamento

- A instalação dos pacotes npm e Python não informa o próprio andamento: a porcentagem do
  instalador avança só quando cada parte termina.

## Interface

- **Prévia não é ao vivo.** A prévia é um vídeo renderizado em resolução reduzida; depois
  de um ajuste, é preciso gerar outra.
- **Timeline sem arrastar e soltar.** Os ajustes são feitos por campos e botões.
- **O plano não é editado trecho a trecho na interface.** Dá para aprovar, rejeitar e
  gerar nova versão; os ajustes finos são feitos na timeline.
- **Um projeto renomeado mantém a pasta de material com o nome antigo.**
- **Sem troca de idioma.** A interface é só em português.

## Análise e edição

- **Marca: leitura do manual.** Cores em Pantone não são convertidas; manuais só com imagens
  (sem texto) dão cores medidas, estimadas; fontes fora do Google Fonts precisam do arquivo; a
  escolha do logo pela IA local é uma estimativa. Os arquivos de fonte de dentro do PDF não são
  aproveitados (vêm recortados e com licença incerta).
- **Marca: cartão com logo.** O cartão final de uma marca é desenhado pela composição do Remotion,
  com animação simples (não pelo HyperFrames).

- **Referências por link sem login.** O programa não entra em contas: o Instagram quase
  sempre recusa e o TikTok às vezes. Nesse caso, salve o vídeo pelo celular ou navegador e
  arraste o arquivo. Os sites mudam com frequência e um link que funcionava pode parar até a
  próxima versão do programa (que traz o yt-dlp atualizado).

- **Sem a IA local nem outro modelo**, ficam como não avaliados: personagens e
  elementos visuais, humor, enquadramentos, tipografia e animações das referências,
  desenvolvimento, suspense e emoção. O roteiro vira uma estrutura com os fatos.
- **IA local testada só com motor simulado.** O ambiente de desenvolvimento não permite
  executar o motor baixado. Os downloads e as somas de verificação foram conferidos com os
  arquivos reais, e todo o funcionamento foi testado com um motor simulado que fala o
  mesmo protocolo. Falta rodar o motor e o modelo de verdade, no Windows (`Testar`, em
  Configurações → IA local).
- **Janelas do prompt no Windows.** A aplicação tenta abrir com um console invisível,
  herdado pelo Remotion, pelo FFmpeg e pelo navegador de render, para que nenhuma janela
  apareça na prévia e na exportação. Na primeira versão dessa correção, a aplicação deixou
  de abrir no Windows de teste. Agora, se o console invisível não der sinal de vida em 20 s,
  a aplicação abre do jeito anterior (e as janelas podem voltar a aparecer). O registro diz
  qual dos dois foi usado. Ainda não conferido no Windows.
- **Qualidade da IA local.** Um modelo de 4 bilhões de parâmetros erra mais que modelos
  grandes de serviços pagos: pode deixar de ver elementos pequenos ou confundir o tom de
  uma fala. Por isso o que ele interpreta é sempre marcado como estimativa. No processador,
  cada vídeo leva bem mais tempo que na placa de vídeo. O 8B escreve melhor, mas numa placa
  de 6 GB parte dele roda no processador, e o roteiro e a análise ficam mais lentos.
- **Poucos efeitos e transições**, de propósito: corte, entrada gradual, fade final, zoom
  lento, correção de cor e barras de cinema. O HyperFrames é usado só no cartão final.
- **Legendas** não são quebradas em frases curtas nem animadas palavra a palavra.
- **Cortes não são sincronizados com a batida da trilha.**
- **Referências só entram por arquivo.** O download autorizado pelo yt-dlp não está na interface.

## Controle de qualidade

- Verificações visuais usam a timeline e amostras de quadro, sem leitura da imagem final (OCR).
- O contraste dos textos ignora a sombra do texto.
- A sincronia é conferida pelo início e pela duração das faixas, não pela fala.

## Aprendizado

- O texto livre do motivo de uma avaliação não é interpretado: só decisões, notas e
  correções geram aprendizado.
- Métricas são digitadas à mão; não há importação das plataformas.

## Validação

- **Testado com vídeos sintéticos** (gerados pelo FFmpeg). Os limites de análise e de
  qualidade ainda precisam ser calibrados com vídeos reais de FiveM, RedM e outros.
- As chaves de API ficam em um arquivo legível só pelo usuário, não no cofre de
  credenciais do Windows.
