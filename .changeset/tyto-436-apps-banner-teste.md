---
'@tyto/cli': patch
'@tyto/desktop': patch
---

The app and `tyto` come with `banner-teste` instead of `banner-roxo` (TYTO-436): the production banner is fetched from `tyto-template-banner` by a plugin file. The tests that drew `banner-roxo` draw `banner-teste`, and the manual's deliveries page starts its brief from `carrossel-lista`.
