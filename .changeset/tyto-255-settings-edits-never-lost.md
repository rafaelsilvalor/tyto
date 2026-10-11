---
'@tyto/desktop': patch
---

TYTO-255: a settings edit is no longer lost while `settings.json` is open in a tab. A change made from a screen right after typing in the tab, or a save of the file from another editor while the tab has unsaved typing, now lands in the tab under the typing, so the next save keeps both. Closing the tab without saving discards only the typing: a change made from a screen while it was open is written to the file.
