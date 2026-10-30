---
'@tyto/cli': minor
---

`tyto render --delivery` now also copies the images the brief uses from outside the delivery's `assets/` into it (TYTO-499, ADR 0161). Nothing there is removed or replaced; a different file of the same name is kept, with a `W_DELIVERY_ASSET_KEPT` warning on stderr and in `result.json`.
