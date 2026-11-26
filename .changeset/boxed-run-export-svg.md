---
'@tyto/export-svg': patch
---

A run's box is not drawn in SVG, which measures no text, and each boxed run reports `W_EXPORT_APPROXIMATED` (ADR 0231, TYTO-900). Its text is drawn as before.
