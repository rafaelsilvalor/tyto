---
'@tyto/desktop': patch
---

Exporting over an artwork file another program holds open ends the export with its failure message instead of an `E_OUTPUT_WRITE` diagnostic, and a folder where an artwork goes shows `E_OUTPUT_FILE_BLOCKED` (TYTO-245, ADR 0108).
