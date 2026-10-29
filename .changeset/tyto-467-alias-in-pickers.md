---
'@tyto/desktop': minor
'@tyto/editor': minor
---

TYTO-467: "New brief from template…" and the "/" menu say when a name is an alias. The row's line reads what it stands for, `aviso · laranja` (in the "/" menu, before what choosing it does), and the plugin file that declares it is on hover in the bar and in the panel CodeMirror opens beside the highlighted "/" row. `templates:list`'s `alias` carries that `file`. In `@tyto/editor`, a `SlashItem` may carry `info`, passed to the completion as CodeMirror's own. A template that is not an alias shows as before.
