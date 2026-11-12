---
'@tyto/io': patch
---

TYTO-643, ADR 0170 note of 2026-11-12: after an Apply that wrote, the recipe runner marks the
applied cell, and the next run plans it again with the cells below it instead of reusing it, so
the plan shows what the Apply changed (`to-brief` now reads `: overwrites` for the briefs it
wrote). The Apply itself plans nothing. An Apply refused, or whose every operation failed,
leaves the cell as it was. An explicit Run of an `apply auto` recipe now plans the applied cell
again and applies that new plan.
