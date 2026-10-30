# Várias artes

Um brief pode gerar um carrossel inteiro: uma série de posts de grid, ou de stories. Um template que faz isso tem um slot que **repete** — a galeria marca "repete: uma arte para cada" — e cada vez que o brief escreve essa diretiva, o Tyto gera mais uma arte.

::: tip
O exemplo é para o `notice`, o template do próprio manual. Copie [a pasta dele](https://github.com/rafaelsilvalor/tyto/tree/main/apps/docs/examples/templates/notice) para a [sua pasta de templates](../templates/templates-folder.md) para rodá-lo.
:::

<<< @/../examples/briefs/carousel.brief{md}

No `notice` o slot que repete é `lamina`. Este brief escreve quatro vezes, então gera quatro artes, cada uma nos dois formatos pedidos: oito imagens. O título é escrito uma vez e aparece em todos os slides.

## Um slide diferente dos outros

As chaves depois de um `::lamina` são [ajustes](./directives.md#ajustes) só daquele slide. Aqui o segundo slide está em destaque, o terceiro é laranja e o quarto é destaque e verde; o primeiro segue as configurações do próprio brief.

## Uma imagem em cada slide

Alguns templates deixam cada slide trazer a própria imagem. A galeria mostra esse slot como "per lamina". Escreva `::imagem ./questao-1.png` na linha logo depois do bloco `::lamina` a que ele pertence, e a do slide seguinte depois do `::lamina` dele.

Cada `::imagem` vai com o `::lamina` escrito antes dele, então não há limite de quantos slides têm imagem. O arquivo é procurado do mesmo jeito que qualquer outra imagem do brief, e um arquivo que não existe fica sublinhado na própria linha. Um `::imagem` antes do primeiro `::lamina`, ou dois para o mesmo slide, também fica sublinhado.

## Quantos slides

Um template pode definir um número mínimo e um máximo de slides. A galeria mostra os dois no slot que repete, como "no mínimo" e "no máximo". Um brief sem nenhum `::lamina` gera uma arte com os outros slots — é assim que o `notice` funciona, e outros templates podem exigir pelo menos um.

## Para onde vão os slides

Na exportação, os arquivos de cada slide são numerados em ordem: `grid-01.png`, `grid-02.png` e assim por diante, um conjunto por formato.
