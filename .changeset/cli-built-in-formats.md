---
'@tyto/cli': patch
---

TYTO-336: `tyto render` and `tyto watch` in a folder with no `formats.yaml` render with the built-in pack's formats, as the window does, instead of stopping with `E_FORMATS_READ`. A `--formats-file` that is not there still fails with `E_FORMATS_READ`, and a `formats.yaml` that is there and malformed still fails as before.
