---
'@tyto/desktop': minor
---

The Explorer marks a folder holding a delivery record as a delivery (TYTO-755, ADR 0210): the
folder wears a delivery icon, the record's `state` sits before the check's mark as the person
wrote it, and the mark's tooltip opens with the record's key and that state. The
`explorer:list` entry's `delivery` carries the record's `key` and `state`.
