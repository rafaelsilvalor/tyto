---
'@tyto/export-svg': patch
---

A centred or right-aligned `<text>` with letter-spacing is aligned by its ink (TYTO-491): the anchor moves by half the spacing, or all of it, because `text-anchor` measures the spacing after the last glyph too. And a font family with a word that is not a CSS identifier — `Source Sans 3` — is now quoted in `font-family`; unquoted, the browser dropped the declaration and drew the fallback face. Families of plain words keep their bytes.
