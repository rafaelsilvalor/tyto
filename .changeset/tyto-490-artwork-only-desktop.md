---
'@tyto/desktop': minor
---

The export box and the export presets write only the artwork into the folder you pick: no `result.json`, no `editaveis/` with the brief, no `assets/` with its images (TYTO-490, ADR 0157). The dialog is the run's report. A file an earlier export wrote and this one did not produce now stays in the folder, and the leftovers list no longer appears. To keep the brief and its images beside the artwork, make a delivery (**File ▸ Delivery: New…**). The queue is unchanged.
