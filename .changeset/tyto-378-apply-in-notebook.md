---
'@tyto/desktop': minor
'@tyto/editor': patch
---

Apply in the recipe notebook (ADR 0170). A plan cell shows its first 20 operations under its
line, then how many it leaves out, and an **Apply** button when main says the plan can be
applied now; the button stays `aria-disabled` while its Apply is on its way. Afterwards each
operation carries its mark, applied, failed or skipped, with its reason, and a line counts them
("2 applied · 1 failed"). A refusal from `recipe:apply` is shown on the cell until the next
run, and an `apply auto` Run outside a trusted folder says it waits for a click. A plan on the
wire now always carries its lines and whether it can be applied. The recipe highlighter colours
`apply auto` as a header line instead of a step.
