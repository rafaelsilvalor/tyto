---
'@tyto/desktop': minor
---

Exporting a delivery from its brief's tab now also copies the images the brief uses from outside the delivery's `assets/` into it (TYTO-499, ADR 0161). Nothing there is removed or replaced; a different file of the same name is kept, and the Export dialog lists `W_DELIVERY_ASSET_KEPT` for it.
