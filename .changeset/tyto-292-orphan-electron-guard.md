---
---

Test-only (TYTO-292): the desktop end-to-end harness writes down every Electron it launches and, when the run ends, ends the ones still running, even after a worker crash — only those whose live command line still carries their own scratch data folder. Nothing ships.
