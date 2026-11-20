---
'@tyto/template-kit': patch
---

`levelsOf` reads only a block's first line by position. A later line with no `#` is a
supporting line, all of it at the base level after the block's main part, so the cargos under
an exam's name no longer come out as a second title.
