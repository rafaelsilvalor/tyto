---
'@tyto/recipe': minor
'@tyto/plugin-api': minor
'@tyto/core': minor
---

TYTO-671, ADR 0193: `call url=<https address> token=<credential> body=<json>`, a generic action
that plans one POST per row to a host the workspace allows and sends nothing until Apply. The
body is JSON whose strings are `{column}` templates; the verb names the credential and never
holds it. `CallPorts` is the port a host lends through `createVerbRegistry({ calls })`, and
`recipeRegistriesOf` forwards its own `calls` option. `@tyto/core` gains `E_RECIPE_CALL`.
