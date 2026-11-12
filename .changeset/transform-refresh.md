---
'@tyto/plugin-api': minor
'@tyto/io': patch
---

A recipe transform is handed `refresh: true` on a run without cache, as a source's `page` is
(TYTO-681): Fetch again and every scheduled run. Isolation protocol 25; `testPlugin`'s
`runRecipe` takes `refresh`.
