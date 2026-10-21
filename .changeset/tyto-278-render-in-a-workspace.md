---
'@tyto/cli': minor
---

TYTO-278: `tyto render` finds the workspace a brief is in by walking up to the nearest `.tyto/project.json`, and uses its template, asset and font folders; `--out` is optional when the project declares `output`, and a typed `--out` or `--templates` still wins. An untrusted workspace renders with everything inside its own folder and prints why a key that leads outside was left out; `--trust` lifts that for one run without writing an approval, and `tyto trust remove <folder>` takes one back (ADR 0111, ADR 0112).
