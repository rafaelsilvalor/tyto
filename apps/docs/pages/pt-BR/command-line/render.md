# Renderizar um brief

::: info Como esta página foi conferida
Cada comando foi executado em 2026-10-19 num build do repositório no commit `b039537` (CLI 0.4.1) no Windows 11, numa pasta com `formats.yaml`, uma pasta `templates/notice` e o `carousel.brief` do manual. As saídas abaixo foram copiadas dessas execuções.
:::

`tyto render` transforma um brief em arquivos numa pasta — os mesmos arquivos que [Exportar](../export/) faz na janela.

```
$ tyto render carousel.brief --out out
grid-01.png
story-01.png
grid-02.png
story-02.png
grid-03.png
story-03.png
grid-04.png
story-04.png
```

Ele imprime cada arquivo à medida que grava. Depois, `out/` tem as oito imagens e um `result.json` que as lista. `--out` é obrigatório.

## Escolher tipos de arquivo, escala e qualidade

`--types` aceita um ou mais de `png`, `jpeg`, `webp` e `svg`, separados por vírgula; só PNG se você não disser nada. `--scale 2` dobra os pixels das imagens, e `--quality` (1 a 100) vale só para JPEG e WebP, como na janela — veja [Imagens](../export/images.md).

```
$ tyto render carousel.brief --out out2 --types svg,webp --scale 2 --quality 80
grid-01.svg
grid-01.webp
story-01.svg
story-01.webp
```

(As quatro primeiras linhas de dezesseis.)

## Entregar numa pasta própria

`--folder` põe os arquivos numa subpasta com o nome do brief, com o brief, o `result.json` e o `template.txt` em `editaveis/` ao lado — o mesmo arranjo que a exportação da janela grava:

```
deliveries/
  carousel/
    grid-01.png
    grid-02.png
    …
    editaveis/
      carousel.brief
      result.json
      template.txt
```

## Quando o brief tem erros

Cada problema sai com o arquivo, a linha e a coluna, o código e o que está errado, e o comando termina com código de saída `1`:

```
$ tyto render broken.brief --out out3
broken.brief:1:1: error E_MISSING_REQUIRED_SLOT Template 'notice' requires slot 'titulo', which the brief does not set.
broken.brief:5:3: error E_UNKNOWN_SLOT Unknown slot 'subtitle'. Template 'notice' declares: titulo, subtitulo, imagem, tom, lamina.
    Did you mean 'subtitulo'?
grid-01.png
```

O que ainda deu para desenhar é gravado, como o `grid-01.png` aqui; então confira o código de saída, e não se apareceram arquivos. Com `--json`, a mesma execução imprime `"status": "error"` e cada problema com `code`, `line` e `column`.

## Outras opções

- `--template` e `--formats` dizem qual template e quais tamanhos usar num brief cujo frontmatter não diz; um brief que diz ganha.
- `--assets` diz onde procurar os caminhos de imagem do brief; por padrão, numa pasta `assets/` ao lado do brief, senão na própria pasta do brief.

O [`tyto render`](../reference/command-line.md#tyto-render) da Referência lista cada opção com o valor padrão.
