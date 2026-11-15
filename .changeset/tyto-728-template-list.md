---
'@tyto/command-line': minor
'@tyto/desktop': minor
---

TYTO-728: `tyto template list [folder]` prints every template a render in that folder can use,
with its origin (built-in, plugin, workspace) and formats, aliases as rows of their own, and
`--json` and `--trust`. It reads the templates through the same steps `tyto render`,
`tyto recipe run` and `tyto delivery new --template` now share, so the list and a render never
disagree; a restricted folder lists what a restricted render can use and says what it left out.
The command panel's `templates` runs it in the session's working folder.
