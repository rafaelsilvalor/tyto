---
'@tyto/desktop': patch
---

TYTO-196: the export dialog and the template picker name each format by its `formats.yaml` label
("Grid 1:1") instead of its id (`grid-1x1`), and still send the id. A format with no label shows
its id, as before.
