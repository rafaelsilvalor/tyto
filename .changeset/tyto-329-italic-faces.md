---
'@tyto/fonts': minor
'@tyto/core': minor
'@tyto/raster': patch
---

TYTO-329: `*italic*` exports. `@tyto/fonts` ships Source Sans 3 Italic (400) and Bold Italic (700) from the same 3.052R release as Regular and Bold, so a brief with italic over a built-in template no longer compiles cleanly and then stops at export with `E_EXPORT_FONT_UNRESOLVED`. A face the font source still cannot answer is now reported by `compile` as `E_FONT_FACE_UNAVAILABLE`, an error that is not fatal, on the text that asks for it, so the Problems panel and `tyto render` say so before the export (ADR 0110). The raster visual suite asks for weight 300 where it asked for italic as the face nobody ships; the user manual drops its warning against italic in both editions.
