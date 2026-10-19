# Briefs

A **brief** is a small text file, ending in `.brief`, that says what goes into an artwork. The template decides how it looks; the brief decides what it says. One brief can produce one artwork or a whole carousel, in every size the template draws.

This is a complete brief:

<<< @/../examples/briefs/first.brief{md}

It has two parts:

- **The frontmatter**, between the two `---` lines: which template to use and which sizes to make. [The frontmatter](./frontmatter.md) has the rest of what can go there.
- **The body**, below it: one line per piece of text, each starting with `::` and the name of a place in the template — a **slot**. Here `::titulo` fills the slot called `titulo` (title). [Directives](./directives.md) explains the forms a line can take.

Each template has its own slots. The [template gallery](../templates/gallery.md) lists every template that comes with Tyto and the slots each one has; a slot a template does not have is an error that names the slot.

::: tip The examples in this section
They are written for `notice`, a small template made for this manual, so that they work in any copy of Tyto. Copy [its folder](https://github.com/rafaelsilvalor/tyto/tree/main/apps/docs/examples/templates/notice) into [your templates folder](../templates/templates-folder.md) and every example on these pages runs in the app. A test compiles each of them, so none shows a brief that does not work.
:::

## When something is wrong

Tyto checks a brief as you type and lists what it found in the Problems panel, each problem with a code and the line it is on. The ones you meet most while writing:

| Code                      | What it means                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `E_NO_TEMPLATE`           | The brief has no `template:` line.                                                          |
| `E_UNKNOWN_TEMPLATE`      | No template has the name the brief gives.                                                   |
| `E_UNKNOWN_SLOT`          | A `::` line names a slot the template does not have.                                        |
| `E_MISSING_REQUIRED_SLOT` | The template needs a slot the brief leaves out.                                             |
| `E_BAD_SLOT_VALUE`        | A slot is given something it does not accept, such as a colour the template does not offer. |
| `E_ASSET_NOT_FOUND`       | An image path does not lead to a file.                                                      |

## In this section

- [The frontmatter](./frontmatter.md) — the template, the sizes, and short values.
- [Directives](./directives.md) — the `::` lines, notes to yourself, and adjustments.
- [Formatting text](./inline-formatting.md) — bold, italic, line breaks and colour.
- [Several artworks](./carousels.md) — carousels and stories from one brief.
- [Formats](./formats.md) — the sizes a brief can ask for.
