---
'@tyto/plugin-api': minor
'@tyto/recipe': minor
'@tyto/core': minor
'@tyto/cli': patch
---

TYTO-376 (ADR 0135), second half: a plugin can contribute recipe actions and sinks. A `recipe-verb` of kind `action` or `sink` is accepted now; it declares `writes`, the kinds of write its plans may hold, a subset of a new top-level `writes` in `tyto-plugin.json`, and is refused at load otherwise (a source or a transform declaring `writes` is refused too). Its `plan(request)` answers a `Plan` — `{ target, operations: [{ write, rowKey?, description }], count }`, new in `@tyto/recipe` with `checkPlan` and `PLAN_LIMITS` — and **nothing is written**: the plan rides the cell's result (`Cell.plan`, `VerbOutput.plan`), and the table passes through to the next cell. The host refuses a plan holding a write the verb did not declare, a `count` that is not the number of operations, a `rowKey` the table does not hold, or more than 10,000 operations, with the new `E_RECIPE_PLAN` from `@tyto/core`, placed at the verb. `tyto` loads an installed plugin that contributes them.
