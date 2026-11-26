---
'@tyto/template-kit': minor
---

BREAKING: `pillTable` and its types `PillTableStyle`, `PillTableColumn` and `PillTableContent` are gone; use `slotTable`, `SlotTableStyle`, `SlotTableColumn` and `SlotTableContent`, the same function and types under their names since TYTO-859 (TYTO-879). Its last callers, agenda-semana and aprovados, moved to `slotTable` in their 1.2.0 releases.
