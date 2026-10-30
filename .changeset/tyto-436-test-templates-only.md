---
'@tyto/templates': minor
---

The production templates leave the built-in pack (TYTO-436): `agenda-semana`, `aprovados`, `simulados-semana-roxo`, `simulados-semana-ocre`, `simulados-semana-vinho` and `tabela-roxo` are gone, with the `_azul` brand module only the first two drew. Each lives in its own repository and reaches a machine through a plugin file (ADR 0151), and with the built-ins out of the way the plugin file's aliases `tabela-roxo` and `simulados-semana-roxo`, `-ocre` and `-vinho` load, and `agenda-semana` and `aprovados` are no longer shadowed. `BUILT_IN_TEMPLATE_NAMES` and `BUILT_IN_TEMPLATE_BUILDS` list what stays: `banner-roxo`, `carrossel-lista` and `promo-curso`.
