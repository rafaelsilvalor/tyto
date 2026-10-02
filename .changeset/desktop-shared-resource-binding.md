---
'@tyto/desktop': patch
---

TYTO-216: the window binds the brief's files and the template's through `layeredExportResources`,
the function `tyto render` already uses, in place of its own two copies. No output changes: the
window's SVG for a `cover` image is byte-identical before and after, and to the CLI's.
