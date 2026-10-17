---
'@tyto/desktop': minor
---

TYTO-298: a new `briefColumns` setting, commented in a new `settings.json`, sets how the editor tells the columns of a brief's `|` lines apart: `off`, `separator` (the `|` coloured, the default), `alternate` (even columns muted too — in some themes the muted colour barely differs from the text) or `perColumn` (a colour per column — some themes draw a column below comfortable reading contrast). Applied on save, with no restart.
