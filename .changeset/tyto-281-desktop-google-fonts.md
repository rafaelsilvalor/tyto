---
'@tyto/desktop': minor
---

The window fetches a template's font this machine lacks from Google Fonts on first use, on save or open and never while typing, and names a font Google does not serve (likely licensed) with the free alternatives its template lists. The new `googleFonts` setting, on by default, turns it off (TYTO-281).
