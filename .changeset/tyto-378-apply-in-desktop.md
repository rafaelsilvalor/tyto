---
'@tyto/desktop': minor
'@tyto/core': minor
---

Apply in the recipe notebook's runner (ADR 0170). Main stamps an id on each plan a cell makes
and keeps the plan object itself; `recipe:apply` names a cell and that id, and main hands that
kept plan back to its verb, refusing a plan replaced by a later run, one applied already, and
one whose cell did not run this time. Applies are one at a time per recipe, and a click applies
in a restricted folder too, with its sections withheld. After an Apply the recipe's state is
committed from the outcome of every plan cell, a plan never applied counting as skipped, and
only while every cell is ok; otherwise the plan is applied and the cell says it was not
remembered (`W_RECIPE_NOT_REMEMBERED`, new in core). A recipe whose header says `apply auto`
applies the plans a Run makes, in cell order, in a trusted folder only; elsewhere the Run stops
at the plan with `held: 'apply'`. The cell on the wire carries its plan's first 50 lines, its id,
whether it can be applied, and how its Apply went. The notebook's Apply button follows.
