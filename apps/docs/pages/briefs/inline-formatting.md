# Formatting text

Text in a directive can carry a little formatting. There is no more than what is on this page: no headings, lists or links, because the template decides the layout.

::: tip
The example is for `notice`, the manual's own template. Copy [its folder](https://github.com/rafaelsilvalor/tyto/tree/main/apps/docs/examples/templates/notice) into [your templates folder](../templates/templates-folder.md) to run it.
:::

<<< @/../examples/briefs/inline-formatting.brief{md}

| You write                       | You get                                              |
| ------------------------------- | ---------------------------------------------------- |
| `**free**`                      | **bold**                                             |
| `*children*`                    | _italic_                                             |
| a new line in an indented block | a new line in the artwork                            |
| `{cor:laranja}this Saturday{/}` | the words in the colour the template calls `laranja` |

## Bold

Two asterisks on each side. In a slot the template already sets in bold, like `notice`'s title, it changes nothing you can see.

## Line breaks

In an [indented block](./directives.md#two-ways-to-write-the-text), every line is a line in the artwork, so the title above has two. A long line still wraps on its own where the template's width ends.

In text written on the directive's own line, a `\` breaks the line there: `::title Free class\this Saturday` is two lines. A block does not need it — its lines already break — so Tyto drops a `\` at the end of a block line and warns with `W_REDUNDANT_BREAK`.

## Colour marks

`{cor:name}` starts a colour and `{/}` ends it. The names are the template's own — `notice` has `laranja` (orange) and `amarelo` (yellow) — and a name the template does not know leaves the words in their usual colour, with no warning.

## Italic

One asterisk on each side, `*like this*`, is italic. Italic inside bold, `**a *free* class**`, is bold italic. The typeface that comes with Tyto has both, so `notice` and the built-in templates draw them.

A template whose typeface has no italic cannot export it. Tyto says so while you write, with `E_FONT_FACE_UNAVAILABLE` on the italic words in the Problems panel; the preview still draws, but no file is written for that artwork until the italic comes out or the template changes.

## Where formatting is read

In the body only. In the [frontmatter](./frontmatter.md) a value is plain text, and Tyto warns with `W_MARKUP_IN_FRONTMATTER` if it finds formatting there.
