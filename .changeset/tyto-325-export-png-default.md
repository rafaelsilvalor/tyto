---
'@tyto/desktop': patch
---

TYTO-325: the Export dialog opens with PNG ticked instead of SVG the first time a window exports. A choice made in the dialog is still kept while the window stays open, and a restart starts from PNG again. A build that does not offer PNG ticks the first file type it does offer, so the dialog never opens with Export greyed out for no visible reason.
