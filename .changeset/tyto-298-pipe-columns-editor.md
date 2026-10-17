---
'@tyto/editor': minor
---

TYTO-298: the columns of a brief's `|` lines are told apart, read as a table template reads them: a `|` inside bold, italic or a mark does not split, columns restart on each line and at a `\` break, and emphasis keeps its own colour. New `briefColumns` option and `setBriefColumns` with four looks — `off`, `separator` (the default), `alternate` and `perColumn` — changed live in every pane, plus `columnMarks` for reading where a line splits.
