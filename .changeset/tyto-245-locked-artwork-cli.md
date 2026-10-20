---
'@tyto/cli': patch
---

`tyto render` exits 2 (internal failure, worth retrying) when an artwork file is held open by another program, and writes no `result.json`; it used to exit 1 with `E_OUTPUT_WRITE` (TYTO-245, ADR 0108). A folder where an artwork goes still exits 1, now reported as `E_OUTPUT_FILE_BLOCKED` with the folder's path.
