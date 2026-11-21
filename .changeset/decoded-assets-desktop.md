---
'@tyto/desktop': minor
---

The window's preview, export and queue draw a file an installed plugin decodes (TYTO-742,
ADR 0223): `capa.psd` as a whole, `capa.psd#arte` as one layer, read by the plugin through a
token main hands it for one call, and kept in `TYTO_HOME/cache/decoded/`. Saving the cited file
again redraws the preview with no keystroke. A folder the window has not trusted decodes nothing
new and says to trust it; with no decoder installed for the kind, the brief's line says a plugin
is needed.
