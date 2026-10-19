# Formatos

Um **formato** é um tamanho: a tela em que uma arte é desenhada. O brief pede formatos na linha `formats:` e recebe uma imagem por formato, para cada arte.

::: tip
O exemplo é para o `notice`, o template do próprio manual. Copie [a pasta dele](https://github.com/rafaelsilvalor/tyto/tree/main/apps/docs/examples/templates/notice) para a [sua pasta de templates](../templates/templates-folder.md) para rodá-lo.
:::

<<< @/../examples/briefs/formats.brief{md}

Este brief pede só o story, embora o `notice` também desenhe `grid`. Sem a linha, saem todos os formatos que o template desenha; pedir um que ele não desenha dá `E_UNKNOWN_FORMAT`.

## Os formatos que vêm com o Tyto

A [galeria de templates](../templates/gallery.md#formatos) lista todos com seus tamanhos. Os nomes seguem uma regra: **o tamanho de costume de um tipo de peça tem só o nome do tipo, e qualquer outro tamanho acrescenta a proporção.**

- `grid` é um post do feed, no 4:5 de costume; `grid-1x1` é o post quadrado.
- `story` é um story.
- `banner` é o banner de costume; `banner-1x1` e `banner-345x146` são o quadrado e a faixa pequena.

## Carrossel e stories não são formatos

Um carrossel são várias artes `grid` em sequência, e stories são várias `story`. O que faz uma série é o template ter um slot que repete, não o tamanho — veja [Várias artes](./carousels.md). A galeria diz o que cada template faz: um grid, um carrossel, um story, stories ou um banner.

## De onde vêm os tamanhos

De um arquivo chamado `formats.yaml`, o único lugar onde um tamanho é escrito: cada linha dá um nome, uma largura e uma altura em pixels, e o tipo de peça. O Tyto traz um junto com os templates. Uma [pasta de templates](../templates/templates-folder.md) sua pode ter o próprio `formats.yaml` ao lado dos templates, que então substitui o interno; sem ele, valem os tamanhos internos.
