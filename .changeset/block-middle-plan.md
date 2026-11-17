---
'@tyto/desktop': minor
---

A recipe block shows the plan of every step that writes, not only its last step's result. An
action in the middle of a block, such as a transition between a source and a sheet sync, draws
its plan under its own line with its own Apply, so no write is left hidden (ADR 0208).
