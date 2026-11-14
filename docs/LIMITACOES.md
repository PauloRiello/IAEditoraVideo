# Limitações conhecidas

Situação da primeira versão utilizável (0.1.0). Nada aqui é escondido pela aplicação: o
que não foi avaliado aparece como "não avaliado", nunca como um palpite.

## Instalação e sistema

- **Windows ainda não testado em máquina real.** A aplicação foi desenvolvida e testada em
  Linux. Os scripts de instalar, iniciar, parar, atualizar, copiar e restaurar são os
  mesmos em todos os sistemas e passam nos testes. O `windows\Instalar.ps1` e o comando do
  atalho foram simulados com o PowerShell fora do Windows
  (`tests/windows/simular_instalador.sh`), o que cobre a lógica e os caminhos de erro. Não
  foram executados: os arquivos `.cmd` (dependem do `cmd.exe`), o winget de verdade, o
  pedido de autorização do Windows, a gravação do atalho, a abertura da janela pelo Edge e
  o comportamento do Windows PowerShell 5.1 (a simulação usa o PowerShell 7, só conferindo
  que nenhum recurso exclusivo dele é usado). É o primeiro item a validar.
- **Não há instalador único (.exe).** A instalação é feita por um script que usa o winget
  para instalar Node.js, Git, FFmpeg e Python. Exige internet e Windows 10 ou 11 com winget.
- **A janela é uma janela do Edge ou do Chrome.** A interface é uma página servida pela
  própria aplicação, só para o próprio computador. Não há ícone próprio na barra de
  tarefas além do atalho.
- **Atualização depende do Git.** Instalações feitas a partir de um ZIP são atualizadas
  baixando o ZIP novo e executando o instalador de novo.
- **Codificação por GPU (NVENC) não testada.** O servidor de desenvolvimento não tem GPU.
  Sem GPU, tudo roda pelo processador.

## Interface

- **Prévia não é ao vivo.** A prévia é um vídeo renderizado em resolução reduzida; depois
  de um ajuste, é preciso gerar outra.
- **Timeline sem arrastar e soltar.** Os ajustes são feitos por campos e botões.
- **O plano não é editado trecho a trecho na interface.** Dá para aprovar, rejeitar e
  gerar nova versão; os ajustes finos são feitos na timeline.
- **Um projeto renomeado mantém a pasta de material com o nome antigo.**
- **Sem troca de idioma.** A interface é só em português.

## Análise e edição

- **Sem modelo de linguagem ou de visão**, ficam como não avaliados: personagens e
  elementos visuais, humor, enquadramentos, tipografia e animações das referências,
  desenvolvimento, suspense e emoção. O roteiro vira uma estrutura com os fatos.
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
