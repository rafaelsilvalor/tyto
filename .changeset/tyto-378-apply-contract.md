---
'@tyto/recipe': minor
'@tyto/core': minor
---

The contract an Apply runs on (ADR 0170). A planned operation may carry the plugin's own
`payload`, at most 2,048 bytes of JSON, which `checkPlan` refuses past; a verb may declare
`apply(plan)`; an applied operation may say `reason` and `appliedAt`; each cell holds what it
asked `remember` to store; `stateToCommit` stamps an applied row's puts with `applied_at`, so a
later run reads `last_applied_at`; and a recipe's header may say `apply auto`, any other word
after `apply` being a syntax error. Core adds `E_RECIPE_APPLY`, the refusal of an Apply whose
shown plan holds a write the verb no longer declares. Nothing applies yet: the host's Apply
lands in the next pull requests of TYTO-378.
