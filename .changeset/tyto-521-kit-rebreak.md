---
'@tyto/template-kit': minor
---

`settle` first breaks the line above a paragraph's lone last word one word earlier, at the same size and spacing, before it tries letter spacing and a smaller size (TYTO-521, ADR 0167 amended). The rebroken runs come back as `setting.runs`; a template that ignores them draws as before. `rebreak` is exported on its own, and `OrphanLimits.rebreak: false` turns it off.
