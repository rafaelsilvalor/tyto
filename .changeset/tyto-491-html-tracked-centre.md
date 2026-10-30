---
'@tyto/export-html': patch
---

A centred or right-aligned line with letter-spacing is aligned by its ink (TYTO-491). CSS adds the spacing after the last glyph too, so such a line used to sit half its spacing left of centre, or its whole spacing short of the right edge — 2.5 px on a signature tracked at 4.9. The line block now gives that space back with a negative right margin. Left and justified text, and text with no letter-spacing, produce the same bytes as before.
