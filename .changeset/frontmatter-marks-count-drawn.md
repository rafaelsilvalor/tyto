---
'@tyto/core': patch
---

On a rich-text slot that declares `frontmatterMarks: true`, `min` and `max` now count the
words a frontmatter value draws, without the `**` and `{key:value}`…`{/}` syntax, as they
count a directive's text. Counted as written, two colour marks in one title overran a `max`
the same words met as a directive: the slot was refused with `E_BAD_SLOT_VALUE` and the
template drew its default title in its place, with neither colour (TYTO-634).
