# Formatação do texto

O texto de uma diretiva pode ter um pouco de formatação. Não há mais do que o que está nesta página: nada de títulos, listas ou links, porque quem decide o layout é o template.

::: tip
O exemplo é para o `notice`, o template do próprio manual. Copie [a pasta dele](https://github.com/rafaelsilvalor/tyto/tree/main/apps/docs/examples/templates/notice) para a [sua pasta de templates](../templates/templates-folder.md) para rodá-lo.
:::

<<< @/../examples/briefs/inline-formatting.brief{md}

| Você escreve                       | Você obtém                                           |
| ---------------------------------- | ---------------------------------------------------- |
| `**free**`                         | **negrito**                                          |
| uma linha nova num bloco com recuo | uma linha nova na arte                               |
| `{cor:laranja}this Saturday{/}`    | as palavras na cor que o template chama de `laranja` |

## Negrito

Dois asteriscos de cada lado. Num slot que o template já desenha em negrito, como o título do `notice`, não muda nada que se veja.

## Quebras de linha

Num [bloco com recuo](./directives.md#dois-jeitos-de-escrever-o-texto), cada linha é uma linha na arte, então o título acima tem duas. Uma linha comprida continua quebrando sozinha onde termina a largura do template.

No texto escrito na própria linha da diretiva, uma `\` quebra a linha ali: `::title Free class\this Saturday` são duas linhas. Um bloco não precisa dela — as linhas dele já quebram —, então o Tyto descarta a `\` no fim de uma linha do bloco e avisa com `W_REDUNDANT_BREAK`.

## Marcas de cor

`{cor:nome}` começa uma cor e `{/}` termina. Os nomes são do template — o `notice` tem `laranja` e `amarelo` — e um nome que o template não conhece deixa as palavras na cor de sempre, sem aviso.

## Itálico, e por que os exemplos não usam

Um asterisco de cada lado, `*assim*`, é itálico. As fontes que vêm com o Tyto não têm itálico, então com um template que usa essas fontes — o `notice` e os templates internos entre eles — a exportação para com `E_EXPORT_FONT_UNRESOLVED`. Use itálico só com um template cuja fonte tenha itálico.

## Onde a formatação é lida

Só no corpo. No [cabeçalho](./frontmatter.md) um valor é texto simples, e o Tyto avisa com `W_MARKUP_IN_FRONTMATTER` se encontrar formatação ali.
