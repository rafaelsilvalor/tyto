---
'@tyto/core': minor
---

A line never starts with a standalone math operator (ADR 0169): the space before `·`, `=`, `×`, `→` and the like is no longer a break, so `Q = U · A · ΔT` may end a line on an operator but never start one with it. `isStandaloneOperator` is exported from `@tyto/core` and `@tyto/core/template`.
