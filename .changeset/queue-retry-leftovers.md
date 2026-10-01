---
'@tyto/desktop': patch
---

TYTO-199: a queue task run again after its brief lost slides no longer keeps the old slides in
`outbox/<id>/out/` (ADR 0059). The queue applies the export box's rule from ADR 0054: only a file
the previous `result.json` listed can go, each removal is a `W_LEFTOVER_REMOVED` warning in the new
`result.json` and in the panel, and a retry that fails again keeps the older files. `tyto watch` is
unchanged.
