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

### Várias imagens entre as linhas de um slide

Quando o slot aparece como "per lamina · multiple", um slide pode ter quantas imagens você escrever, e cada uma entra onde você a escreve no meio das linhas do slide. O caminho fica na linha do `::imagem`, e as linhas recuadas abaixo dele continuam o texto do slide.

Escreva `::lamina` com o primeiro parágrafo recuado abaixo dele, depois `::imagem ./grafico.png` com o segundo parágrafo recuado abaixo, depois `::imagem ./foto.png`. Esse slide fica assim: o primeiro parágrafo, o gráfico, o segundo parágrafo, a foto. O próximo `::lamina` começa o slide seguinte. Uma imagem cujo arquivo não existe fica sublinhada na própria linha, e o texto abaixo dela continua pertencendo ao slide.

### Diretivas dentro de diretivas

Alguns templates vão mais fundo: um `::bloco` dentro de um slide, e um `::paragrafo` dentro do bloco. A galeria mostra um slot assim como "per bloco", o que quer dizer que ele pertence ao `::bloco` escrito por último acima dele no mesmo slide.

Quem decide o que fica dentro de quê é o template, não os espaços no começo da linha. Você pode recuar o `::bloco` abaixo do `::lamina` e o `::paragrafo` abaixo do `::bloco` para enxergar a estrutura, ou escrever todas as linhas no começo da linha: a arte sai igual. O [**Format Brief**](../editor/format-brief.md) recua cada diretiva conforme a profundidade que o template dá a ela, então a estrutura aparece sem ninguém contar espaços. Um `::paragrafo` sem `::bloco` acima dele no mesmo slide fica sublinhado. Para começar uma linha de texto com `::`, escreva `\::`.

## Quantos slides

Um template pode definir um número mínimo e um máximo de slides. A galeria mostra os dois no slot que repete, como "no mínimo" e "no máximo". Um brief sem nenhum `::lamina` gera uma arte com os outros slots — é assim que o `notice` funciona, e outros templates podem exigir pelo menos um.

## Para onde vão os slides

Na exportação, os arquivos de cada slide são numerados em ordem: `grid-01.png`, `grid-02.png` e assim por diante, um conjunto por formato.
