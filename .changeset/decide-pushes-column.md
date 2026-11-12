---
'@tyto/recipe': minor
---

`decide` also writes `<column>_pushes`, a boolean true exactly on push rows, so a write to the remote side can choose its rows without reading the pushed value.
