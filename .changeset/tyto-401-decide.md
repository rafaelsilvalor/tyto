---
'@tyto/recipe': minor
---

TYTO-401 (ADR 0140): `decide <column> local=<column> remote=<column> last=<column> [values=a,b|@ref] [first-run-wins=<value>] [hold-when-empty=<column>]` decides, row by row, which side of a sync wins, ported from Buraqueira's `decidir`: whichever side changed since the last applied run wins, the local one when both did; with no last value only `first-run-wins` beats the remote side, and without it the remote side fills. Values compare without accents, case or surrounding blanks; an empty remote value is intermediate; a local value `values=` does not list is replaced. It adds `<column>`, `<column>_action` (push, pull, same or hold), `<column>_overrides` and `<column>_reason`; a push where `hold-when-empty=` is empty becomes `hold`. `decideValue` exports the rule itself.
