---
'@tyto/desktop': minor
---

TYTO-323: a carousel's slides show as a strip of numbered thumbnails under the preview, and the Slide dropdown is gone. Clicking a thumbnail puts that slide on the stage and the editor on its `::lamina`; with the strip focused, the arrow keys, Home and End move along it. Thumbnails are the slide's own live document, scaled to 96 px tall; only the ones on screen are drawn, and a keystroke redraws only the slide it changed. A button in the preview's bar hides the strip, and each preview tab remembers that across a restart. When the slide shown is deleted from the end of the brief, the preview stays on the new last slide instead of going back to slide 1.
