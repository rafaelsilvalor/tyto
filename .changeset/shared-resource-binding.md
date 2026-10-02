---
'@tyto/io': minor
'@tyto/cli': patch
---

TYTO-216: `layeredExportResources` in `@tyto/io` puts several sources of export bytes together,
the first that answers a ref winning, for `asset` and `assetSize`. `tyto render` binds the brief's
files and the template's through it, in place of its own two copies. No output changes: the CLI's
SVG for a `cover` image is byte-identical before and after, and to the window's.
