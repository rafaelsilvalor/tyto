---
'@tyto/cli': minor
---

`tyto template check` takes a folder along the route `tyto render` would. A code template
the build ships (`agenda-semana`) no longer fails with a read error for the `template.html`
it does not have: its manifest is checked and reported, and the report states that the body
was not checked — a `not checked:` line, or `notChecked` under `--json`. Exit 0 there means
the manifest is clean. Shipped code with a `template.html` beside it is
`E_TEMPLATE_AMBIGUOUS`, as at render time, and a `template.ts` nothing ships gets a hint
saying folder code is never loaded. Markup folders are checked exactly as before.
