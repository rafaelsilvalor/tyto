---
'@tyto/desktop': minor
---

TYTO-535: the command panel has commands of its own, `help`, `clear` (or `cls`), `history`,
`!N`, `last` and `exit`, offered in its completion. `&&` runs the next command only when the one
before ended with exit code 0, and `*` and `?` expand to the matching files of the open workspace
folder (`render *.brief`), never outside it; a pattern that matches nothing is refused. Every
`tyto` command a line runs keeps its own refusals and trust rules (ADR 0200).
