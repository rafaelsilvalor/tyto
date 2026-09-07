---
'@tyto/brief-lang': minor
---

Emphasis now nests in both directions: `*italic with **bold** inside*` parses, alongside `**bold with *italic* inside**`, which already did. Neither kind may hold itself, which is the ambiguity `*a*b*c*` poses and the one an LR parser cannot resolve.

Two adjacent closers still do not parse — `**bold *italic***` leaves both runs open, because longest match reads the trailing `***` as `**` then `*`. Write `**bold *italic* **` or reorder. `broken-adjacent-emphasis.brief` pins where the error lands: four identical empty nodes at the end of the line, which the editor has to collapse by offset.

ADR 0015 records the decision and hands E3.2 the consequence: `Bold` and `Italic` carry `children`, not a string.
