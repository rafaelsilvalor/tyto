---
'@tyto/desktop': minor
'@tyto/core': minor
---

TYTO-188: each local queue folder chooses which file types its tasks produce, in the queue
panel's "Produces" row, installed exporters' kinds included. A folder nobody chose for still
produces PNG alone. A chosen kind whose plugin was removed is left out with a new
`W_QUEUE_KIND_UNAVAILABLE` warning instead of failing the task (ADR 0061).
