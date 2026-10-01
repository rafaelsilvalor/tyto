---
'@tyto/cli': patch
---

TYTO-211: a task `tyto watch` renders again after its brief lost slides no longer keeps the old
slides in `outbox/<id>/out/` (ADR 0060). It applies the rule the desktop queue uses (ADR 0059):
only a file the previous `result.json` listed can go, each removal is a `W_LEFTOVER_REMOVED`
warning in the new `result.json`, and a run that fails keeps the older files. `tyto render --out`
is unchanged and still removes nothing.
