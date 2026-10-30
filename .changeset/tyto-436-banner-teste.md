---
'@tyto/templates': minor
---

`banner-roxo` leaves the built-in pack (TYTO-436): the house's product banner lives in its own repository, `tyto-template-banner`, and reaches a machine through a plugin file (ADR 0151). In its place the pack ships `banner-teste`, a test code template drawn by the same `productBanner` from `@tyto/house-style` over invented flat backgrounds, so the tests of a template that is code, reads its own folder and measures its text keep a target. `BUILT_IN_TEMPLATE_NAMES` and `BUILT_IN_TEMPLATE_BUILDS` list `banner-teste`, `carrossel-lista` and `promo-curso`.
