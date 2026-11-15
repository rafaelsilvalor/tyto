---
'@tyto/editor': minor
'@tyto/recipe': patch
'@tyto/command-line': minor
---

TYTO-727: the recipe editor colours `const` as a header line and a `set` step's name, `=` and
aggregate, offers the aggregates after `set <name> = `, and offers the names in scope after a
`{`: every `param` and `const`, and each `set` above the step. `@tyto/recipe` exports
`SET_AGGREGATES` and `readSet` for it, explains the `set` form's syntax in its help, and rounds a
`sum` to 15 significant digits, so `0.1 + 0.2` is `0.3`. `tyto recipe run` prints the value a
`set` step set and its note, as text and in `--json`, and `run_recipe` answers both.
