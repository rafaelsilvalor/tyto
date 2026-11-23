---
'@tyto/core': minor
'@tyto/plugin-api': minor
'@tyto/house-style': minor
---

A brand kit may carry a background pattern (ADR 0228, TYTO-842): `BrandKit.pattern`, a tile of toned layers, each filled or stroked, with no colour and no opacity. `brandKitSchema` checks it under a toned mark's bounds, the plugin protocol is 32, and `drawPattern` in `@tyto/house-style` lays the tile over an area in the inks and the opacity the template picks, cut by a mask it names. A template that does not call it draws what it drew before.
