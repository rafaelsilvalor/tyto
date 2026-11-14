---
'@tyto/recipe': minor
'@tyto/io': minor
'@tyto/core': patch
---

TYTO-727: a recipe's header takes `const name = value`, a value used as `{name}` that nothing
outside the recipe overrides, and the generic verb `set name = <aggregate>` keeps one value
computed from the table (`count`, `min`, `max`, `first`, `last` or `sum` of a column) for the
steps below it. `param`, `const` and `set` share one set of names, and a `set` name is known only
below its step (ADR 0199). The notebook's runner hands a slice the values its reused `set` cells
computed, and reruns every cell when a const changes. `E_RECIPE_PARAM`'s summary names the three.
