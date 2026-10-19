# O cabeçalho

O cabeçalho é o bloco entre as duas linhas `---` no alto do brief. Ele tem uma configuração por linha, escrita `nome: valor`.

::: tip
O exemplo é para o `notice`, o template do próprio manual. Copie [a pasta dele](https://github.com/rafaelsilvalor/tyto/tree/main/apps/docs/examples/templates/notice) para a [sua pasta de templates](../templates/templates-folder.md) para rodá-lo.
:::

<<< @/../examples/briefs/frontmatter.brief{md}

## As duas configurações de todo brief

- **`template`** — o nome do template, exatamente como a [galeria](../templates/gallery.md) escreve. Sem ela o brief dá `E_NO_TEMPLATE`.
- **`formats`** — os tamanhos a gerar, entre colchetes e separados por vírgula. Cada um tem que ser um tamanho que o template desenha; [Formatos](./formats.md) lista todos. Sem essa linha, saem todos os tamanhos que o template desenha.

Os nomes `template` e `formats` são do próprio Tyto e são sempre em inglês. Todo o resto é um slot do template, então o nome é o que o template deu — os templates internos usam nomes em português.

## Slots no cabeçalho

Um slot de valor curto e fixo fica mais legível aqui do que no corpo. Três tipos de slot cabem:

- **Uma escolha de uma lista**, como `tom: verde`. A galeria mostra os valores que cada um aceita e o padrão quando você não escreve nada. Qualquer outro valor dá `E_BAD_SLOT_VALUE`, que diz os valores permitidos.
- **Uma imagem**, como `imagem: ./photo.png`. O caminho é lido a partir da pasta do brief; se não houver nada lá, a partir de uma pasta `assets` ao lado do brief. Uma imagem que não está em nenhuma das duas dá `E_ASSET_NOT_FOUND`.
- **Uma linha de texto simples**, como `subtitulo: Saturday, 10 am to 4 pm`. Simples quer dizer simples: negrito, itálico e marcas de cor não são lidos no cabeçalho, e o Tyto avisa com `W_MARKUP_IN_FRONTMATTER`. Texto que precisa de formatação vai no corpo, como [diretiva](./directives.md).

Um valor com dois-pontos seguidos de espaço, ou que começa com aspas ou colchete, precisa de aspas em volta: `subtitulo: "Aberto: 10h"`.
