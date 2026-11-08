---
'@tyto/recipe': minor
---

TYTO-421: `decide` takes `tie=local|remote`, the side that wins a row both sides changed since
the last run (`local` when not given, as before). It also writes `<column>_push`, the decided
value on push rows only, and `<column>_overwritten`, the losing side's value where both
changed; `<column>_overrides` is now true on such a row whichever side wins. The decided column
may be the `local=` column itself, rewritten in place as `map` rewrites its `into=`.
`Decision` gains `overwritten`.
