# Directives

Below the frontmatter, every line that starts with `::` is a **directive**: the name of a slot, then the text that fills it.

::: tip
The examples are for `notice`, the manual's own template. Copy [its folder](https://github.com/rafaelsilvalor/tyto/tree/main/apps/docs/examples/templates/notice) into [your templates folder](../templates/templates-folder.md) to run them.
:::

<<< @/../examples/briefs/directives.brief{md}

## Two ways to write the text

- **On the same line**, after the name and a space: `::titulo Open day at the library`. Good for a short line.
- **On the lines below**, indented by two spaces. The text runs until the next line that is not indented. Use it for longer text, and for text that has to break where you say: each line of the block is a line in the artwork.

## Notes to yourself

A line that starts with `//` is a note. Tyto skips it, so it can say anything — who asked for the artwork, what to check before sending it.

## A line that starts with `::` but is not a directive

Put a backslash in front: `\::` is shown as `::` and starts nothing.

## Adjustments

Some templates let you change one artwork, or one slide of a carousel, without touching the others. That change is an **adjustment**, written in braces after the directive's name: `::lamina {destaque}`, `::lamina {tom: laranja}`, or both, `::lamina {destaque, tom: verde}`.

A word on its own, like `destaque` (highlight), switches something on. A `name: value` pair picks one value of a list. The [gallery](../templates/gallery.md) lists each template's adjustments, the slots they go on and the values they take; [Several artworks](./carousels.md) has a whole brief that uses them. An adjustment the template does not declare for that slot is `E_BAD_ADJUSTMENT`.

## Directives from plugins

A name with a slash, like `::ai/caption`, belongs to a plugin. It works when that plugin is installed and is `E_UNKNOWN_DIRECTIVE` when it is not.
