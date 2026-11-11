---
'@tyto/desktop': minor
'@tyto/plugin-api': minor
'@tyto/recipe': minor
---

TYTO-671, ADR 0193: the window sends a recipe's `call` requests. A person stores the credential
a `call` line names in the plugins screen's new Recipe credentials section, write-only, kept in
the keychain under `recipe:<name>`, listed by name and forgotten from there; Apply then sends
each planned request to a host the trusted folder's `recipes.call.hosts` allows. `recipe:` is
reserved in `@tyto/plugin-api` (`RECIPE_CREDENTIAL_KEY_PREFIX`) like `signin-client:`: no
plugin's `credentials:` permission or `host.credentials` call reaches it. `@tyto/recipe` exports
`CALL_CREDENTIAL_NAME`, and its "store it first" refusal names the screen and the CLI's variable.
