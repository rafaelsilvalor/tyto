# Briefs

Um **brief** é um arquivo de texto pequeno, terminado em `.brief`, que diz o que vai numa arte. O template decide a aparência; o brief decide o conteúdo. Um brief pode gerar uma arte ou um carrossel inteiro, em todos os tamanhos que o template desenha.

Este é um brief completo:

<<< @/../examples/briefs/first.brief{md}

Ele tem duas partes:

- **O cabeçalho**, entre as duas linhas `---`: qual template usar e quais tamanhos gerar. [O cabeçalho](./frontmatter.md) mostra o que mais cabe ali.
- **O corpo**, abaixo dele: uma linha por texto, cada uma começando com `::` e o nome de um lugar do template — um **slot**. Aqui `::titulo` preenche o slot chamado `titulo`. [Diretivas](./directives.md) explica as formas que uma linha pode ter.

Cada template tem os seus slots. A [galeria de templates](../templates/gallery.md) lista todos os templates que vêm com o Tyto e os slots de cada um; um slot que o template não tem é um erro que diz o nome do slot.

::: tip Os exemplos desta seção
Eles são escritos para o `notice`, um template pequeno feito para este manual, para que funcionem em qualquer cópia do Tyto. Copie [a pasta dele](https://github.com/rafaelsilvalor/tyto/tree/main/apps/docs/examples/templates/notice) para a [sua pasta de templates](../templates/templates-folder.md) e todos os exemplos destas páginas rodam no app. Um teste compila cada um, então nenhum mostra um brief que não funciona.
:::

## Quando algo está errado

O Tyto confere o brief enquanto você digita e lista o que encontrou no painel de problemas, cada problema com um código e a linha em que está. Os que mais aparecem ao escrever:

| Código                    | O que quer dizer                                                                  |
| ------------------------- | --------------------------------------------------------------------------------- |
| `E_NO_TEMPLATE`           | O brief não tem a linha `template:`.                                              |
| `E_UNKNOWN_TEMPLATE`      | Nenhum template tem o nome que o brief dá.                                        |
| `E_UNKNOWN_SLOT`          | Uma linha `::` nomeia um slot que o template não tem.                             |
| `E_MISSING_REQUIRED_SLOT` | O template precisa de um slot que o brief deixou de fora.                         |
| `E_BAD_SLOT_VALUE`        | Um slot recebeu algo que ele não aceita, como uma cor que o template não oferece. |
| `E_ASSET_NOT_FOUND`       | O caminho de uma imagem não leva a um arquivo.                                    |

## Nesta seção

- [O cabeçalho](./frontmatter.md) — o template, os tamanhos e valores curtos.
- [Diretivas](./directives.md) — as linhas `::`, anotações e ajustes.
- [Formatação do texto](./inline-formatting.md) — negrito, itálico, quebra de linha e cor.
- [Várias artes](./carousels.md) — carrosséis e stories a partir de um brief.
- [Formatos](./formats.md) — os tamanhos que um brief pode pedir.
