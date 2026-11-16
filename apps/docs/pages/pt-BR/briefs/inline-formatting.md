# Formatação do texto

O texto de uma diretiva pode ter um pouco de formatação. Não há mais do que o que está nesta página: nada de títulos, listas ou links, porque quem decide o layout é o template.

::: tip
O exemplo é para o `notice`, o template do próprio manual. Copie [a pasta dele](https://github.com/rafaelsilvalor/tyto/tree/main/apps/docs/examples/templates/notice) para a [sua pasta de templates](../templates/templates-folder.md) para rodá-lo.
:::

<<< @/../examples/briefs/inline-formatting.brief{md}

| Você escreve                          | Você obtém                                           |
| ------------------------------------- | ---------------------------------------------------- |
| `**free**`                            | **negrito**                                          |
| `*children*`                          | _itálico_                                            |
| uma linha nova num bloco              | uma linha nova na arte                               |
| uma linha em branco entre duas linhas | um parágrafo novo                                    |
| `{cor:laranja}this Saturday{/}`       | as palavras na cor que o template chama de `laranja` |

## Negrito

Dois asteriscos de cada lado. Num slot que o template já desenha em negrito, como o título do `notice`, não muda nada que se veja.

## Quebras de linha

Num [bloco nas linhas de baixo](./directives.md#dois-jeitos-de-escrever-o-texto), cada linha é uma linha na arte, então o título acima tem duas. Uma linha comprida continua quebrando sozinha onde termina a largura do template.

No texto escrito na própria linha da diretiva, uma `\` quebra a linha ali: `::title Free class\this Saturday` são duas linhas. Um bloco não precisa dela — as linhas dele já quebram —, então o Tyto descarta a `\` no fim de uma linha do bloco e avisa com `W_REDUNDANT_BREAK`.

## Parágrafos

Uma linha em branco entre duas linhas de um bloco começa um parágrafo novo. Várias linhas em branco seguidas continuam sendo um parágrafo só, e uma linha em branco logo abaixo da diretiva ou no fim do bloco não significa nada.

<<< @/../examples/briefs/paragraphs.brief{md}

A distância entre dois parágrafos é escolha do template. Um template que não escolhe nada desenha os parágrafos como linhas comuns, sem espaço a mais, então um brief que já tinha linhas em branco entre os grupos fica exatamente como era. Uma [anotação](./directives.md#anotacoes) (`//`) entre duas linhas não é uma linha em branco e não começa parágrafo.

## Marcas de cor

`{cor:nome}` começa uma cor e `{/}` termina. Os nomes são do template — o `notice` tem `laranja` e `amarelo` — e um nome que o template não conhece deixa as palavras na cor de sempre, sem aviso.

## Itálico

Um asterisco de cada lado, `*assim*`, é itálico. Itálico dentro do negrito, `**uma aula *grátis* hoje**`, é negrito itálico. A fonte que vem com o Tyto tem os dois, então o `notice` e os templates internos desenham ambos.

Um template cuja fonte não tem itálico não consegue exportá-lo. O Tyto avisa enquanto você escreve, com `E_FONT_FACE_UNAVAILABLE` nas palavras em itálico no painel de Problemas; a prévia continua desenhando, mas nenhum arquivo é gravado para aquela arte até o itálico sair ou o template mudar.

## Fórmulas

Escreva uma fórmula entre dois `$`. Dentro dela, `\frac{cima}{baixo}` empilha uma fração sobre um traço, `^` sobe um expoente e `_` desce um índice. Cada um recebe um grupo entre chaves, ou um único caractere sem elas: `$x^2$` é o mesmo que `$x^{2}$`. Um grupo pode ter outra fração ou outro expoente, como em `$\frac{1}{10^{3}}$`.

<<< @/../examples/briefs/formulas.brief{md}

| Você escreve                          | Você obtém                                             |
| ------------------------------------- | ------------------------------------------------------ |
| `$F = \frac{1}{40·10^{-3}} = 25\ Hz$` | `1` empilhado sobre `40·10⁻³`, com um traço entre eles |
| `$E = mc^2$`                          | `E = mc²`                                              |
| `$v_0^2$`                             | `v` com `2` em cima e `0` embaixo                      |
| `R$ 50 to R$ 60`                      | os preços, como escritos                               |

A fórmula é desenhada na fonte, no tamanho e na cor do template, então uma fórmula dentro de `**…**` ou de uma marca de cor também os recebe. Os espaços dentro dela ficam como você escreveu, e uma fórmula nunca se quebra em duas linhas.

Dentro de uma fórmula, a `\` é da fórmula: ali ela não quebra a linha. Escreva `\ ` para um espaço que deve ficar depois de um número (`25\ Hz`), e `\$`, `\{` ou `\}` para esses caracteres.

### Preços não são fórmulas

Um `$` abre uma fórmula só quando o caractere seguinte não é um espaço, e a fecha só quando o caractere antes dele não é um espaço e o seguinte não é um dígito. É isso que mantém dinheiro como texto: `R$ 50`, `de R$ 50 a R$ 60` e `R$50 a R$60` não têm fórmula. Escreva todos os preços de uma linha do mesmo jeito: em `R$50 e R$ 60` os dois `$` formam um par e as palavras entre eles viram uma fórmula, sem o `$`.

### Quando uma fórmula tem um erro

O Tyto a desenha exatamente como você escreveu, com o `$`, e sublinha a parte que não entendeu: `E_FORMULA_COMMAND` para um comando que não é `\frac` (`\sqrt` não é desenhado), `E_FORMULA_GROUP` para uma chave que falta ou ficou aberta, e `E_FORMULA_EMPTY` para `$$` ou `{}`. O resto do brief não é afetado.

## Onde a formatação é lida

Só no corpo. No [cabeçalho](./frontmatter.md) um valor é texto simples, e o Tyto avisa com `W_MARKUP_IN_FRONTMATTER` se encontrar formatação ali, a menos que o template declare que desenha `**…**` e `{cor:…}…{/}` naquele campo.
