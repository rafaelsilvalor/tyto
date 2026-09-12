---
'@tyto/export-html': minor
---

Line boxes now use the face the node embeds, not the browser's default.

A text node carried `line-height` but declared no font, so its block strut came from the
document default — Times New Roman at 16px — and decided the leading whenever it was
taller than the runs. A node asking for `lineHeight: 1.45` over a single 15px run laid out
at 23.75px per line instead of 21.75. The node now also carries `font-family`, `font-size`
and `font-weight`, taken from its largest run, which is what `docs/ir-schema.md` means by
"a multiplier of the run's font size".

Every multi-line text whose runs are smaller than roughly 16px moves. That is the leading
the IR asked for arriving, not a regression, but it does change rendered output: pre-1.0,
a minor.
