# The frontmatter

The frontmatter is the block between the two `---` lines at the top of a brief. It holds one setting per line, written `name: value`.

::: tip
The example is for `notice`, the manual's own template. Copy [its folder](https://github.com/rafaelsilvalor/tyto/tree/main/apps/docs/examples/templates/notice) into [your templates folder](../templates/templates-folder.md) to run it.
:::

<<< @/../examples/briefs/frontmatter.brief{md}

## The two settings every brief has

- **`template`** — the template's name, exactly as the [gallery](../templates/gallery.md) writes it. Without it the brief is `E_NO_TEMPLATE`.
- **`formats`** — the sizes to make, in square brackets and separated by commas. Each one has to be a size the template draws; [Formats](./formats.md) lists them. Leave the line out and you get every size the template draws.

The names `template` and `formats` are Tyto's own and are always in English. Everything else is a slot of the template, so its name is the template's — the built-in templates name theirs in Portuguese.

## Slots in the frontmatter

A slot whose value is short and fixed reads better here than in the body. Three kinds of slot fit:

- **A choice from a list**, like `tom: verde`. The gallery lists the values each one accepts, and its default when you leave it out. Any other value is `E_BAD_SLOT_VALUE`, which names the values allowed.
- **An image**, like `imagem: ./photo.png`. The path is read from the folder the brief is in; when nothing is there, from an `assets` folder beside the brief. An image that is in neither is `E_ASSET_NOT_FOUND`.
- **A line of plain text**, like `subtitulo: Saturday, 10 am to 4 pm`. Plain is the word: bold, italic and colour marks are not read in the frontmatter and Tyto warns with `W_MARKUP_IN_FRONTMATTER`. Text that needs formatting goes in the body, as a [directive](./directives.md).

A value with a colon followed by a space, or one that starts with a quote or a bracket, needs quotes around it: `subtitulo: "Open: 10 am"`.
