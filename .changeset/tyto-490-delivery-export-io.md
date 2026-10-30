---
'@tyto/io': major
---

`fsDeliveryExportOutput({ artwork, report, label? })` writes a delivery's export (TYTO-490, ADR 0157 §6): the artwork into the delivery's `exports` folder, `result.json` and `template.txt` into its brief's folder. What its previous export wrote and this one did not is removed (ADR 0054). It answers `Result<DeliveryExportOutput, Diagnostic[]>`, with `E_DELIVERY_FOLDER_BLOCKED` when a file holds either folder.

**Breaking for `@tyto/io` callers:** `recordingAssetResolver` and `DeliveredAsset` are removed. Nothing has copied a brief's images since part A of TYTO-490.
