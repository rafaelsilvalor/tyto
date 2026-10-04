---
'@tyto/desktop': minor
---

TYTO-223: the window's preview, export and queue hand each template the brand kit its
manifest's `brand` names, from the installed plugins (ADR 0063). When two plugins offer one
brand, the one registered first is used and `W_BRAND_KIT_SHADOWED` appears with the preview's
and the export's diagnostics.
