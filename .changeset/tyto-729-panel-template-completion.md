---
'@tyto/desktop': patch
---

The command panel completes `--template` and `--formats` from `tyto template list --json` run
in the session's working folder (TYTO-729), no longer from the window's template picker: a
name it offers is one a render there accepts, the folder's own `templates/` included and a
restricted folder's plugin files left out. The answer is kept per working folder and trust,
and asked again after a template, plugin, file or trust change, or after a panel run.
