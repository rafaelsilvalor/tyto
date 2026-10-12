---
'@tyto/desktop': minor
---

TYTO-266: the template mode is kept on quit like the tabs are. Quitting with unsaved changes to a template's `manifest.yaml` or `template.html` asks nothing any more; the next launch reopens the mode on the same folder with the unsaved text in it. If the file changed on disk in between, the mode shows the disk's text and the draft opens in a new tab beside it, named in the problems panel. Closing the mode and choosing Discard now really drops its unsaved text.
