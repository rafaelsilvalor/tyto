---
'@tyto/templates': minor
'@tyto/core': patch
---

TYTO-224: the built-in brands and templates are renamed by colour. The brand ids are `azul`, `roxo`, `ocre` and `vinho`; the templates are `simulados-semana-roxo`, `simulados-semana-ocre`, `simulados-semana-vinho`, `tabela-roxo` and `banner-roxo`, and `agenda-semana` and `aprovados` keep their names. A brief naming a template by its previous name must use the new one. Every template draws the same bytes as before for the same brief; the examples of `aprovados`, `banner-roxo`, `simulados-semana-vinho` and `tabela-roxo` now carry invented copy of the same shape. `@tyto/core`'s message for a malformed `brand` gives `azul` as its example.
