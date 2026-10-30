---
'@tyto/cli': minor
---

`tyto render <brief> --delivery` exports a delivery's brief into the delivery (TYTO-490, ADR 0157 §6). The artwork goes to its `exports` folder (the root by default), and `result.json` and `template.txt` go beside the brief. Artwork the previous export wrote and this one did not is removed. It renders the delivery's `formats` and `types` when the project names them, else the brief's own sizes as PNG. `--delivery` cannot be used with `--out` or `--folder`. A brief in no delivery is `E_BRIEF_NOT_IN_DELIVERY`, exit 1.
