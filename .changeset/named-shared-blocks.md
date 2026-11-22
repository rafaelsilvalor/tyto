---
'@tyto/core': minor
'@tyto/plugin-api': minor
---

A slide's own block adds to the shared ones instead of replacing them; a `shared` slot may be `multiple`; `{nome: …}` names a shared block and an empty directive inside a slide places it there; `context.order` carries each block's value and the `anchored` place (ADR 0227, TYTO-838).
