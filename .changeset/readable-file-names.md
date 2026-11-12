---
'@tyto/core': minor
'@tyto/pipeline': patch
'@tyto/recipe': patch
---

TYTO-640: `fileSafeName` keeps the base letter of an accented Latin letter (`Matemática` →
`Matematica`, `Straße` → `Strasse`), drops a trailing dot or space, and gives a Windows device
name (`CON`, `nul.brief`, `COM1`…) a `_` on its stem. Both callers change with it: a `to-brief`
row named `Matemática` writes `Matematica.brief`, and a format named `miniatura-vídeo` is
delivered as `miniatura-video-01.png` (ADR 0053, note of 2026-11-12). Names that were already
ASCII-safe are unchanged.
