---
'@tyto/editor': minor
---

Folding a directive folds the blocks nested in it (TYTO-748, ADR 0207): a `::lamina` folds
over the `::bloco` and `::paragrafo` its template's manifest nests under it, up to the next
sibling or ancestor, and one with no body of its own but blocks under it folds too. Sticky
scroll pins the chain (`::lamina` above `::bloco`), and the fold gutter and the sticky rows
redraw when the analysis brings or changes the manifest. A brief whose template declares no
nesting folds exactly as before.

The package's public exports are unchanged; the nesting helpers stay inside `@tyto/editor`.
