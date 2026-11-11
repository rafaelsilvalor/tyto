---
'@tyto/core': minor
'@tyto/io': minor
'@tyto/command-line': minor
---

TYTO-671, ADR 0193: `call`'s adapter and the workspace's allow-list. `.tyto/project.json` learns
`recipes.call.hosts`, read from trusted sheets only, a later sheet's list replacing an earlier
one whole, as `ResolvedProject.callHosts`. `@tyto/io` adds `recipeCallPorts`: the platform's
`fetch` with no redirect followed, an abort at the deadline, the host re-checked with `URL`
against the list, the credential read and set as the header on the host's side, the response's
body never read, and every failure said with the credential replaced by `[credential]`. The
recipe runner takes a `calls` option and binds it to each run's folder. `tyto mcp`'s
`run_recipe` plans `call` against the list and `TYTO_RECIPE_CREDENTIAL_<NAME>` and sends nothing.
