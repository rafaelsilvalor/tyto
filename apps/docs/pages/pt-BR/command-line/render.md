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

Ele imprime cada arquivo à medida que grava. Depois, `out/` tem as oito imagens e um `result.json` que as lista. `--out` é obrigatório, a não ser que o brief esteja numa pasta de trabalho cujo arquivo de projeto diga uma pasta de saída (abaixo).

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

## Renderizar dentro de uma pasta de trabalho

Uma pasta de trabalho é uma pasta de projeto com um `.tyto/project.json` dentro. O arquivo diz onde o projeto guarda seus templates, imagens e fontes, e para onde vão as exportações:

```jsonc
{
  // where this project keeps its things
  "templates": ["tpl"],
  "assets": ["art"],
  "output": "exports",
}
```

O `tyto render` procura esse arquivo na pasta do brief e em cada pasta acima dela, então um brief em qualquer lugar do projeto o usa sem você digitar nada. Os comandos abaixo foram executados em 2026-10-21 numa pasta assim, com o brief em `briefs/`, o template em `tpl/` e a imagem em `art/`:

```
$ tyto render briefs/cartaz.brief --types svg
feed-01.svg
feed-02.svg
```

Os arquivos foram para `exports/`. Um `--out` que você digitar continua valendo mais, e `--templates` também. Caminhos de imagem são procurados primeiro ao lado do brief, depois em `assets/` ao lado dele, depois nas pastas `assets` do projeto.

### Uma pasta em que você ainda não confiou

Até você confiar numa pasta de trabalho, toda pasta que o arquivo do projeto nomeia precisa estar dentro dela. Um nome que leva para fora — `../shared/exports`, um caminho absoluto, ou um atalho dentro da pasta que aponta para outro lugar — fica de fora e é impresso:

```
$ tyto render briefs/cartaz.brief --types svg
.tyto\project.json:4:13: warning W_PROJECT_PATH_OUTSIDE Project key 'output' leads outside this folder ('../shared/exports'), which an untrusted folder may not do; it is left out.
error: --out is required: .tyto\project.json declares no output folder this run may use
```

`--trust` confia na pasta só naquela execução e não anota nada. `tyto trust remove <pasta>` desfaz uma confiança dada antes; as pastas em que você confia ficam listadas no `trust.json` da sua pasta do Tyto (`~/.tyto`).

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

- `--template` diz qual template usar num brief cujo frontmatter não cita nenhum; um brief que cita ganha.
- `--formats` diz quais tamanhos fazer. Num brief com linha `formats:`, escolhe alguns dos tamanhos dessa linha; um tamanho que a linha não tem dá `E_FORMAT_NOT_IN_BRIEF`. Num brief sem a linha, é a lista de tamanhos.
- `--assets` diz onde procurar os caminhos de imagem do brief; por padrão, numa pasta `assets/` ao lado do brief, senão na própria pasta do brief.

O [`tyto render`](../reference/command-line.md#tyto-render) da Referência lista cada opção com o valor padrão.
