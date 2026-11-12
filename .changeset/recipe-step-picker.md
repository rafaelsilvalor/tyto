---
'@tyto/desktop': minor
'@tyto/editor': minor
---

TYTO-402, ADR 0176: Add step and Edit step over a recipe. Add step opens a picker of every verb
a recipe may name here, grouped into sources, transforms, actions and sinks, searchable and
keyboard-navigable, then the verb's form; Edit step opens the form of the step on the cursor's
line, filled by `valuesOfStep`. The form writes one line through `formatStep`, below the cursor's
step or at the end; a value one line cannot carry is refused with `E_RECIPE_FORM` next to its
field and nothing is written. Column fields offer the columns of the cell before the step.
`recipe:verbs` answers an additive `catalog` (each verb's kind and form fields, a plugin verb's
from its declared arguments), and the new `recipe:vocabulary-names` channel answers what a
`@./<file>.vocab.json#/<pointer>` may name, read only inside the recipe's folder.
`recipeCompletion` in `@tyto/editor` takes an optional source that completes those references
(`completeRecipeReference`).
