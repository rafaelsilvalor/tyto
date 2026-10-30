---
'@tyto/io': major
---

`fsArtworkOutput(directory, { label? })` writes artwork into a folder and nothing beside it: no `result.json`, no copied brief, no `assets/` (TYTO-490, ADR 0157). It answers `Result<ReusableTaskOutput, Diagnostic[]>`, with `E_DELIVERY_FOLDER_BLOCKED` when a file holds the folder's name; its `removeLeftovers` removes nothing, because without a report no file is known to be Tyto's.

**Breaking for `@tyto/io` callers:** `fsDeliveryOutput`, `DeliveryOutput` and `FsDeliveryOutputOptions` are removed, and nothing writes ADR 0057's `editaveis/` + `assets/` layout any more. Use `fsArtworkOutput` for a folder a person picked, or `fsTaskOutput` where a `result.json` belongs. The render contract's exit-code text now says `--folder` writes no `result.json`.
