---
'@tyto/desktop': minor
---

TYTO-143 (ADR 0076): the status bar's problems button carries a small accent dot beside the count when the window raised a problem of its own — a save that failed, a recent file that is gone, a template folder with no templates — while the problems panel was not on screen (closed, or inside a hidden bottom area). Showing the panel clears it; compiler diagnostics from typing never light it. Changing the template folder no longer drops a live failed-save or missing-file row from the panel.
