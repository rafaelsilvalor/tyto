---
'@tyto/recipe': minor
---

A recipe line may name a column it writes or picks in double quotes, with accents and blanks:
`into="Última Sync"`, `compose "Última Sync"={due|slug}`, `select key, "Última Sync"`. Bare
names keep their rule; the form library quotes such names and round-trips them (TYTO-674).
