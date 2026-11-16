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
| a new line in a block           | a new line in the artwork                            |
| a blank line between two lines  | a new paragraph                                      |
| `{cor:laranja}this Saturday{/}` | the words in the colour the template calls `laranja` |

## Bold

Two asterisks on each side. In a slot the template already sets in bold, like `notice`'s title, it changes nothing you can see.

## Line breaks

In a [block on the lines below](./directives.md#two-ways-to-write-the-text), every line is a line in the artwork, so the title above has two. A long line still wraps on its own where the template's width ends.

In text written on the directive's own line, a `\` breaks the line there: `::title Free class\this Saturday` is two lines. A block does not need it — its lines already break — so Tyto drops a `\` at the end of a block line and warns with `W_REDUNDANT_BREAK`.

## Paragraphs

A blank line between two lines of a block starts a new paragraph. Several blank lines in a row are still one paragraph, and a blank line right under the directive or at the end of the block means nothing.

<<< @/../examples/briefs/paragraphs.brief{md}

How far apart two paragraphs are is the template's choice. A template that chooses nothing draws them as ordinary lines, with no extra space, so a brief that already had blank lines between groups looks exactly as it did. A [note](./directives.md#notes-to-yourself) (`//`) between two lines is not a blank line and starts no paragraph.

## Colour marks

`{cor:name}` starts a colour and `{/}` ends it. The names are the template's own — `notice` has `laranja` (orange) and `amarelo` (yellow) — and a name the template does not know leaves the words in their usual colour, with no warning.

## Italic

One asterisk on each side, `*like this*`, is italic. Italic inside bold, `**a *free* class**`, is bold italic. The typeface that comes with Tyto has both, so `notice` and the built-in templates draw them.

A template whose typeface has no italic cannot export it. Tyto says so while you write, with `E_FONT_FACE_UNAVAILABLE` on the italic words in the Problems panel; the preview still draws, but no file is written for that artwork until the italic comes out or the template changes.

## Formulas

Write a formula between two `$`. Inside it, `\frac{top}{bottom}` stacks a fraction over a rule, `^` raises a superscript and `_` lowers a subscript. Each takes a group in braces, or a single character without them: `$x^2$` is the same as `$x^{2}$`. A group may hold another fraction or another script, as in `$\frac{1}{10^{3}}$`.

<<< @/../examples/briefs/formulas.brief{md}

| You write                             | You get                                              |
| ------------------------------------- | ---------------------------------------------------- |
| `$F = \frac{1}{40·10^{-3}} = 25\ Hz$` | `1` stacked over `40·10⁻³`, with a rule between them |
| `$E = mc^2$`                          | `E = mc²`                                            |
| `$v_0^2$`                             | `v` with `2` above and `0` below                     |
| `R$ 50 to R$ 60`                      | the prices, as written                               |

The formula is drawn in the template's typeface, size and colour, so a formula inside `**…**` or a colour mark takes them too. Spaces inside it are kept as you write them, and a formula never breaks across two lines.

Inside a formula, `\` belongs to the formula: it is not a line break there. Write `\ ` for a space you want kept after a number (`25\ Hz`), and `\$`, `\{` or `\}` for those characters.

### Prices are not formulas

A `$` opens a formula only when the next character is not a space, and closes it only when the character before it is not a space and the next one is not a digit. That is what keeps money as text: `R$ 50`, `R$ 50 to R$ 60` and `R$50 to R$60` hold no formula. Write every price the same way in a line: in `R$50 and R$ 60` the two `$` pair up and the words between them become a formula, without its `$`.

### When a formula has a mistake

Tyto draws it exactly as you wrote it, `$` included, and underlines the part it did not understand: `E_FORMULA_COMMAND` for a command other than `\frac` (`\sqrt` is not drawn), `E_FORMULA_GROUP` for a brace missing or left open, and `E_FORMULA_EMPTY` for `$$` or `{}`. The rest of the brief is not affected.

## Where formatting is read

In the body only. In the [frontmatter](./frontmatter.md) a value is plain text, and Tyto warns with `W_MARKUP_IN_FRONTMATTER` if it finds formatting there, unless the template declares that it draws `**…**` and `{cor:…}…{/}` in that field.
