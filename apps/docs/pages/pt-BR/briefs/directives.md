# Diretivas

Abaixo do cabeçalho, toda linha que começa com `::` é uma **diretiva**: o nome de um slot e depois o texto que o preenche.

::: tip
Os exemplos são para o `notice`, o template do próprio manual. Copie [a pasta dele](https://github.com/rafaelsilvalor/tyto/tree/main/apps/docs/examples/templates/notice) para a [sua pasta de templates](../templates/templates-folder.md) para rodá-los.
:::

<<< @/../examples/briefs/directives.brief{md}

## Dois jeitos de escrever o texto

- **Na mesma linha**, depois do nome e de um espaço: `::titulo Open day at the library`. Bom para uma linha curta.
- **Nas linhas de baixo**, com recuo de dois espaços. O texto vai até a próxima linha sem recuo. Use para texto mais longo e para texto que precisa quebrar onde você quer: cada linha do bloco é uma linha na arte.

## Anotações

Uma linha que começa com `//` é uma anotação. O Tyto pula, então ela pode dizer qualquer coisa — quem pediu a arte, o que conferir antes de enviar.

## Uma linha que começa com `::` mas não é diretiva

Ponha uma barra invertida na frente: `\::` aparece como `::` e não começa nada.

## Ajustes

Alguns templates deixam você mudar uma arte, ou um slide de um carrossel, sem mexer nos outros. Essa mudança é um **ajuste**, escrito entre chaves depois do nome da diretiva: `::lamina {destaque}`, `::lamina {tom: laranja}`, ou os dois, `::lamina {destaque, tom: verde}`.

Uma palavra sozinha, como `destaque`, liga alguma coisa. Um par `nome: valor` escolhe um valor de uma lista. A [galeria](../templates/gallery.md) lista os ajustes de cada template, os slots em que eles entram e os valores que aceitam; [Várias artes](./carousels.md) tem um brief inteiro que usa ajustes. Um ajuste que o template não declara para aquele slot dá `E_BAD_ADJUSTMENT`.

## Diretivas de plugins

Um nome com barra, como `::ai/caption`, é de um plugin. Funciona quando o plugin está instalado e dá `E_UNKNOWN_DIRECTIVE` quando não está.
