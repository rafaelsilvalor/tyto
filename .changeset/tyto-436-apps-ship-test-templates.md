---
'@tyto/cli': patch
'@tyto/desktop': patch
---

The app and `tyto` come with the test templates only (TYTO-436): `banner-roxo`, `carrossel-lista` and `promo-curso`. The house's production templates are fetched from their own repositories by a plugin file, which the manual's template gallery points to; without one, they are not listed. The tests that drew a removed template draw a remaining one.
