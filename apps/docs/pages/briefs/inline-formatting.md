# Formatting text

Text in a directive can carry a little formatting. There is no more than what is on this page: no headings, lists or links, because the template decides the layout.

::: tip
The example is for `notice`, the manual's own template. Copy [its folder](https://github.com/rafaelsilvalor/tyto/tree/main/apps/docs/examples/templates/notice) into [your templates folder](../templates/templates-folder.md) to run it.
:::

<<< @/../examples/briefs/inline-formatting.brief{md}

| You write                       | You get                                              |
| ------------------------------- | ---------------------------------------------------- |
| `**free**`                      | **bold**                                             |
| a new line in an indented block | a new line in the artwork                            |
| `{cor:laranja}this Saturday{/}` | the words in the colour the template calls `laranja` |

## Bold

Two asterisks on each side. In a slot the template already sets in bold, like `notice`'s title, it changes nothing you can see.

## Line breaks

In an [indented block](./directives.md#two-ways-to-write-the-text), every line is a line in the artwork, so the title above has two. A long line still wraps on its own where the template's width ends.

In text written on the directive's own line, a `\` breaks the line there: `::title Free class\this Saturday` is two lines. A block does not need it — its lines already break — so Tyto drops a `\` at the end of a block line and warns with `W_REDUNDANT_BREAK`.

## Colour marks

`{cor:name}` starts a colour and `{/}` ends it. The names are the template's own — `notice` has `laranja` (orange) and `amarelo` (yellow) — and a name the template does not know leaves the words in their usual colour, with no warning.

## Italic, and why the examples do not use it

One asterisk on each side, `*like this*`, is italic. The typefaces that come with Tyto have no italic, so with a template that uses them — `notice` and the built-in templates among them — exporting stops with `E_EXPORT_FONT_UNRESOLVED`. Use italic only with a template whose typeface has one.

## Where formatting is read

In the body only. In the [frontmatter](./frontmatter.md) a value is plain text, and Tyto warns with `W_MARKUP_IN_FRONTMATTER` if it finds formatting there.
