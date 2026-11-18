# Marcas (identidade visual)

Uma marca guarda o **logo**, as **cores** e as **fontes** de um cliente ou de uma empresa. Cada
projeto pode escolher uma marca pronta, e a montagem aplica a identidade visual nos vídeos dele.

## Cadastrar uma marca

1. No menu **Marcas**, clique em **Nova marca** e dê um nome.
2. **Manual da marca (PDF):** arraste o manual. O programa lê página por página, com
   porcentagem, e sugere o que encontrou, sempre dizendo de onde veio:
   - **Cores escritas no manual** (`#1A2B3C`, `RGB 255 200 0`, `R: G: B:`, `CMYK 0 100 100 0`),
     com a página e o papel quando o texto disser ("primária", "secundária", "destaque"). CMYK é
     convertido e marcado como conversão. Pantone não é convertido (não há tabela oficial livre).
   - **Sem nenhum código escrito**, as cores dominantes são **medidas** nas páginas e marcadas
     como estimadas.
   - **Logo:** as imagens do PDF que parecem logo (com transparência, nas primeiras páginas,
     sem miniaturas nem fotos de página inteira). Com a IA local instalada, ela ajuda a ordenar;
     é uma estimativa.
   - **Fontes:** os nomes citados no manual ("Tipografia: Montserrat") e os usados no próprio PDF.
3. **Confirme:** escolha o logo (ou envie o arquivo), ajuste as cores e os papéis e salve.
4. **Fontes:** para cada uma (títulos e legendas), **Procurar no Google Fonts**. Se estiver lá
   (gratuita, com licença que permite uso comercial), o programa pergunta antes de baixar. Se não
   estiver, envie o arquivo da fonte (TTF, OTF, WOFF) ou **Deixe pendente**: o vídeo usa a fonte
   padrão até lá.
5. Clique em **Marca pronta**. Só marcas prontas aparecem no projeto.

Sem manual, a mesma tela serve para cadastrar à mão; ao enviar o logo, **Sugerir cores do logo**
mede as cores dele.

O PDF e todos os arquivos enviados são **copiados** para a pasta da marca
(`<dados>/marcas/<marca>/`); os originais não são tocados. As marcas entram nas cópias de
segurança.

## No projeto

No formulário do projeto, escolha a **Marca (identidade visual)**. Ao montar a timeline:

| Elemento | O que acontece |
|---|---|
| Logo durante o vídeo | No canto escolhido (padrão: superior direito, 8% da altura, opacidade 85%). Em vídeo vertical, sempre no topo, dentro da área segura |
| Fim do vídeo | Com cartão final (CTA), o logo e as cores da marca entram nele. Sem cartão, um encerramento de 2 s na cor primária com o logo |
| Legendas | Com caixa (decisão do estilo), a caixa vai para a cor primária e o texto para a cor de texto da marca, se for legível; senão branco ou preto, e a decisão explica. Sem caixa, o texto continua branco com sombra; só a fonte muda |
| Textos e cartões | Fonte de títulos da marca; textos com caixa ganham as cores da marca |
| GIF animado | Vira um trecho de vídeo com transparência e anima junto com o vídeo |

Cada escolha aparece em **Por que a aplicação montou assim**, com origem "marca".

A marca decide **cor, fonte e logo**. O estilo e o que o programa aprendeu continuam decidindo
**se há caixa na legenda, posição, tamanhos e animações**.

## Quando a marca muda

A timeline guarda uma cópia da marca do momento da montagem: editar a marca não muda um vídeo já
montado ou aprovado. Na edição aparece **A marca do projeto mudou** com o botão **Aplicar marca
atual**, que cria uma versão nova da timeline trocando só o que veio da marca. Edições feitas à
mão (inclusive uma cor mudada à mão) continuam. Mover ou tirar o logo na edição não ensina nada ao
perfil: posição e opacidade do logo são ajustes da própria marca.
