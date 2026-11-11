---
'@tyto/command-line': minor
'@tyto/io': minor
---

`tyto recipe run <recipe>` runs a recipe from the terminal through the shared runner, in the
workspace that holds it (TYTO-673). Without `--apply` it plans only, commits no state and
prints every cell, row count and operation; `--json` prints the whole answer as one document,
every row and operation with its payload, nothing cut. `--apply` applies every plan once and
commits the recipe's state, in a trusted folder only, and is how the CLI sends `call`'s
requests. `--param name=value` gives a `param` line a value, and `--section` works as on
`tyto render`. The runner in `@tyto/io` takes the values for a run's `param` lines.
