---
'@tyto/editor': minor
'@tyto/desktop': minor
---

TYTO-295: while the top of the editor is inside a block, the block's head line stays pinned
there — `::lamina` while scrolling its body, and in the template mode each element the top is
inside, stacked. The row slides away with the block's last line, a click on it goes to the
directive, and the caret is never left under it. `"stickyScroll": false` in `settings.json`
turns it off on save. A directive's fold now ends at its last line with text.
