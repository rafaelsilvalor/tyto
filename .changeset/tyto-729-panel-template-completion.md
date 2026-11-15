---
'@tyto/desktop': patch
'@tyto/command-line': minor
'@tyto/io': patch
---

The command panel completes `--template` and `--formats` from `tyto template list --json
--no-sync` run in the session's working folder (TYTO-729), no longer from the window's
template picker: a name it offers is one a render there accepts, the folder's own `templates/`
included and a restricted folder's plugin files left out. The answer is kept per working folder
and trust, and asked again after a template, plugin, file or trust change, or after a panel
run; what the listing left out is said once in the panel.

`tyto template list --no-sync` fetches nothing: a plugin file whose copy is not on this
computer yet is left out, and the error output names it. A plugin folder sync that does not
fetch takes the reason it gives (`notFetchedBecause`), `tyto watch`'s by default.
