---
'@tyto/recipe': minor
'@tyto/core': minor
'@tyto/desktop': patch
---

TYTO-714: `decide` with `clear=push` holds the clears of a run that look like a lost read. When
the `local=` column is missing or empty on every row while `last` holds values, no clear is
pushed and one `W_RECIPE_DECIDE_CLEAR_COLUMN` names the column; when a run would push more
clears than the new `clear-limit=<n>|none` (5 when not given), none is pushed and one
`W_RECIPE_DECIDE_CLEAR_LIMIT` gives the count. A held clear is a `hold` row whose decided value
is the last one, so the state does not advance. The desktop's recipe form gains the
`clear-limit` field's Portuguese help, and the user manual a section on syncing a field both
ways.
