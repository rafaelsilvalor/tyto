---
'@tyto/desktop': patch
---

TYTO-214: the window's preview and export hand a bundled code template the files in its own folder,
through `context.files` (ADR 0062), as `tyto render` does. Before, a code template could not draw a
background kept beside its manifest in the app.
