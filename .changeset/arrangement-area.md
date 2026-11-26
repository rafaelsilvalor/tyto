---
'@tyto/template-kit': minor
---

The arrangements take an area and a parameter schema (TYTO-891): `stackIn`, `rowIn`, `insetIn`, `markIn` and `iconIn` with `STACK_PARAMETERS`, `ROW_PARAMETERS`, `INSET_PARAMETERS`, `MARK_PARAMETERS` and `ICON_PARAMETERS`, returning their overflow; a stack item may state its own gap above it; `stackIn` and `blockColumn` take `measureFrom: 'capitals'`; and `weightedSpacing` returns a weights mismatch as a result. `stack`, `row`, `inset`, `mark`, `icon` and the deprecated `spaceByWeight` draw the same bytes as before.
