# Guia de instalação

A IA Editora de Vídeo é instalada no seu computador e funciona sozinha: depois de
instalada, não depende de nenhum outro programa aberto nem de internet para editar.

> **Situação dos testes.** A instalação, o início, a parada, a atualização, a cópia de
> segurança e a restauração são testados em Linux, com os mesmos scripts usados no
> Windows. O instalador foi executado uma vez em um Windows real (Windows 11, Node.js 26,
> Python 3.14, placa NVIDIA RTX 3050): instalou o FFmpeg pelo winget, as dependências, o
> banco e o atalho, e 9 das 11 verificações passaram. As duas que falharam (Whisper na
> placa de vídeo e render do HyperFrames) foram corrigidas depois, e a correção ainda não
> foi conferida no Windows. **Ainda não foram testados em Windows:** abrir a aplicação
> pelo atalho, a janela no Edge, o uso da aplicação, atualizar, copiar e restaurar. Veja
> [LIMITACOES.md](LIMITACOES.md).

## O que é preciso

| Item | Requisito |
|---|---|
| Sistema | Windows 10 ou 11, 64 bits (também roda em macOS e Linux) |
| Espaço em disco | Cerca de 3 GB para o programa e as dependências, mais o espaço dos seus vídeos |
| Memória | 8 GB no mínimo; 16 GB recomendados |
| Placa de vídeo | Não é necessária. Se houver uma placa NVIDIA, ela é detectada e usada |
| Internet | Só durante a instalação e as atualizações |
| Conhecimento de programação | Nenhum |

## Instalação no Windows, passo a passo

1. **Baixe o programa.** Na página do projeto no GitHub, clique em **Code → Download ZIP**
   e extraia o arquivo em uma pasta sua (por exemplo `C:\IA Editora de Video`).
   Quem preferir pode baixar só a pasta `windows`: nesse caso o instalador obtém o
   programa pelo Git e o coloca em `%LOCALAPPDATA%\Programs\IAEditoraVideo`.
2. **Execute o instalador.** Abra a pasta `windows` e dê dois cliques em **`Instalar.cmd`**.
   Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações →
   Executar assim mesmo**.
3. **Dependências.** O instalador confere e instala o que faltar, pelo instalador de
   pacotes do próprio Windows (winget): Node.js, Git, FFmpeg e Python. O Windows pode pedir
   autorização. Em seguida ele instala as bibliotecas do programa (Remotion, HyperFrames,
   Whisper e outras). Na primeira vez isso leva vários minutos.
4. **Pastas.** O instalador mostra onde ficarão os dados e os vídeos e pergunta a pasta dos
   vídeos e exportações. Aperte Enter para aceitar a sugestão ou digite outra pasta, de
   preferência em um disco com bastante espaço.
5. **Verificação.** Cada ferramenta é testada (Node, Python, FFmpeg, FFprobe, GPU, GSAP,
   Remotion, HyperFrames, Whisper, yt-dlp). O resumo diz o que passou. Um aviso não impede
   o uso; ele indica qual recurso pode não funcionar.
6. **Abra a aplicação** pelo atalho **IA Editora de Video**, criado na Área de Trabalho e
   no Menu Iniciar (ou por `windows\Iniciar.cmd`).

O instalador pode ser executado de novo a qualquer momento, por exemplo para reparar a
instalação: ele só instala o que falta, não apaga nem sobrescreve o que já existe e
mantém as pastas de dados e de vídeos escolhidas na primeira vez.

**Opções do instalador** (para quem precisar):

| Opção | Efeito |
|---|---|
| `Instalar.cmd -Ramo nome-do-ramo` | Com o instalador sozinho: baixa um ramo específico do repositório, por exemplo para testar uma versão ainda não publicada no ramo principal |
| `Instalar.cmd -Pasta "D:\Programas\IA Editora"` | Com o instalador sozinho: escolhe onde o programa é colocado |
| `Instalar.cmd --padrao` | Não pergunta nada e usa as pastas sugeridas |
| `Instalar.cmd --biblioteca "D:\Videos"` | Define a pasta dos vídeos e exportações |

## Onde fica cada coisa

| Conteúdo | Pasta padrão no Windows |
|---|---|
| Programa | A pasta onde você extraiu o ZIP, ou `%LOCALAPPDATA%\Programs\IAEditoraVideo` |
| Dados (banco, configurações, cópias de segurança, registros) | `%LOCALAPPDATA%\IAEditoraVideo` |
| Vídeos brutos, referências e exportações | `Documentos\IA Editora de Video` (ou a pasta escolhida) |

Os dados e os vídeos ficam separados do programa. Por isso atualizar ou reinstalar o
programa não apaga projetos, aprendizados nem exportações. As pastas escolhidas ficam
gravadas em `config\local.instalacao.json`, dentro da pasta do programa.

## Arquivos de uso diário

| Para | Windows | Qualquer sistema |
|---|---|---|
| Instalar ou reparar | `windows\Instalar.cmd` | `npm run instalar` |
| Abrir | Atalho ou `windows\Iniciar.cmd` | `npm run iniciar` |
| Fechar | Botão **Encerrar** na janela, ou `windows\Parar.cmd` | `npm run parar` |
| Atualizar | `windows\Atualizar.cmd` | `npm run atualizar` |
| Cópia de segurança | `windows\Backup.cmd` | `npm run backup` |
| Restaurar uma cópia | `windows\Restaurar.cmd` | `npm run restaurar` |

## Instalação em macOS e Linux

Instale antes Node.js 22.20 ou mais recente, Python 3.11 ou mais recente, FFmpeg e Git.
Depois, na pasta do programa:

```bash
npm run instalar
```

```bash
npm run iniciar
```

## Como a aplicação abre e fecha

- **Abrir** inicia a aplicação em segundo plano e abre a janela dela (uma janela própria
  do Microsoft Edge ou do Chrome; se nenhum dos dois existir, uma aba do navegador padrão).
- A aplicação só atende ao próprio computador, e a janela só funciona quando aberta pelo
  atalho ou pelo inicializador.
- **Encerrar**, na própria janela, fecha a aplicação com segurança.
- Se a janela for fechada sem encerrar, a aplicação termina o que estiver processando e
  se encerra sozinha depois de um minuto e meio sem janela.
- Abrir de novo com a aplicação já aberta só reabre a janela: nunca há duas ao mesmo tempo.

## Problemas comuns

| O que aparece | O que fazer |
|---|---|
| "winget não foi encontrado" | Instale o "Instalador de Aplicativo" pela Microsoft Store e execute o instalador de novo |
| Um programa "foi instalado, mas ainda não aparece" | Feche a janela do instalador, abra de novo e execute outra vez |
| "O programa não pôde ser baixado do GitHub" | Confira a internet. Se o repositório for privado, entre na sua conta quando o Git pedir |
| Linhas com `[FALHA]` na etapa de dependências | Leia a linha: em geral falta Python ou FFmpeg, ou a internet caiu. Corrija e execute de novo |
| "a aplicação ainda não foi instalada nesta pasta" ao abrir | Execute `windows\Instalar.cmd` |
| A janela não abre sozinha | O inicializador mostra um endereço: copie-o para o navegador |
| "a aplicação fechou logo ao iniciar" | A mensagem indica o arquivo de registro (`aplicacao.log`) e mostra as últimas linhas |
| Verificação do Whisper com aviso sobre a placa de vídeo | A transcrição funciona pelo processador. Para usar a placa NVIDIA, execute o instalador de novo: ele instala as bibliotecas CUDA (download de cerca de 1 GB) |
| Verificação do HyperFrames com aviso | A aplicação funciona: usa outro navegador para o cartão final ou o desenha pelo Remotion. Feche outros programas e repita só essa verificação, na pasta do programa: `node scripts\verificar\hyperframes.mjs`. Não use `npx hyperframes`: ele pode baixar outra versão, diferente da que o programa usa |
| O primeiro render demora mais | Na primeira vez o programa prepara a composição (cerca de 40 s) e pode baixar o navegador de render |
| A primeira transcrição demora | O modelo do Whisper é baixado uma vez; depois funciona sem internet |

## Desinstalar

1. Feche a aplicação.
2. Apague os atalhos **IA Editora de Video** da Área de Trabalho e do Menu Iniciar.
3. Apague a pasta do programa.
4. Para apagar também os dados, apague `%LOCALAPPDATA%\IAEditoraVideo`. Seus vídeos e
   exportações ficam na pasta que você escolheu e não são tocados.

Node.js, Git, FFmpeg e Python continuam instalados; remova-os pelo Windows, se quiser.
