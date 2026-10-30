---
'@tyto/plugin-api': minor
'@tyto/core': minor
'@tyto/io': minor
'@tyto/cli': patch
'@tyto/desktop': patch
---

An installed plugin's code template reads files from its own folder (TYTO-478, ADR 0062). `context.files.image` and `context.files.svg` answer what the host read from the template's folder inside the installed plugin, and a declared image value's default resolves against the same folder; `tyto render` and the desktop embed those bytes in the export. **Breaking for plugins: the protocol is 12** (ADR 0149 point 4), because a template's `build` now carries a fourth argument, `ShippedFiles`, which a guest on 11 refuses. A path out of the folder, an absolute one or a file the host did not read answers `undefined`, and the folder's reader skips a link that leads out of it.
