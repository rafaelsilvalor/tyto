---
'@tyto/cli': minor
---

TYTO-223: `tyto render` and `tyto watch` hand each template the brand kit its manifest's `brand`
names, from the built-in and installed plugins (ADR 0063). When two plugins offer one brand, the
one registered first is used and `W_BRAND_KIT_SHADOWED` in `result.json` names the one it hid.
