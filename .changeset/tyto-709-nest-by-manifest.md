---
'@tyto/brief-lang': minor
'@tyto/core': minor
'@tyto/editor': minor
'@tyto/plugin-api': patch
---

A slot nests inside another by its `per`, to any depth (TYTO-709, ADR 0207). `per` may now
name another `per` slot (`paragrafo: { per: bloco }`, `bloco: { per: lamina }`), and a
directive belongs to the nearest open occurrence of its parent above it. A template reads a
slide's own slots flat in `context.slots`, as before, and deeper values in an optional `slots`
on their parent: `context.slots.bloco.slots?.paragrafo`. No protocol bump.

**Breaking for one rare case:** an indented `::` line is now a directive, exactly as at
column 0 (ADR 0202 decision 3). A brief that used an indented `::` as text — 0 of 405 `.brief`
files measured on the maintainer's machine — now reads it as a directive, usually
`E_UNKNOWN_SLOT`; write `\::` to keep it text. An indented `//` is still a comment.

`@tyto/core`: `slotDepth` is exported; the manifest refuses a `per` cycle, a `per` chain that
does not end at the repeatable slot, and `multiple` below the slide. A new brief's skeleton
writes a required nested slot under its required parent, one level deeper.

`@tyto/brief-lang`: `formatBrief` takes an optional `depthOf` and indents each directive by
its depth in the template's tree.

`@tyto/editor`: Format Brief reads the depth from the analysis's manifest; `briefBlocks` gives
each block its `depth` and `parent`; the breadcrumb names the chain
(`::lamina 2 › ::bloco › ::paragrafo`) and Go to Block indents a nested label.

`@tyto/plugin-api`: a test pins that nested slots cross to an isolated template (test only).
