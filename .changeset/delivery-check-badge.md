---
'@tyto/desktop': minor
---

The Explorer marks each delivery folder of a trusted folder with its exports checked against
its record (TYTO-757, ADR 0215): ✓ ready to check, ! incomplete, … in progress, each problem
in the mark's tooltip. Main checks again a moment after files land, through the same check a
recipe's `deliveries` reads, and lends the format catalogue to the recipe runner as the fallback
for `delivery.sizes`.
