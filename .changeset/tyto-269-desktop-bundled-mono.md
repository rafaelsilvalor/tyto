---
'@tyto/desktop': patch
---

TYTO-269: the brief editor draws with the bundled IBM Plex Mono instead of whichever monospace the machine has, so it shows the same face and the same columns on every computer, in light and in dark. Comments stay italic, slanted by the browser, since no italic face is shipped.
