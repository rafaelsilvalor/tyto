---
'@tyto/core': minor
'@tyto/templates': minor
---

TYTO-195: a template's manifest can name its brand (`brand: estrategia-saude`), lower case letters, digits and single hyphens (ADR 0052). It is optional, so existing manifests still load. The built-in templates name theirs: `agenda-semana` and `aprovados` are `estrategia-saude`, `carrossel-lista` and `promo-curso` are `tyto-demo`. No brief changes and no render changes.
