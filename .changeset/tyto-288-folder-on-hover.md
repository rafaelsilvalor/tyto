---
'@tyto/desktop': minor
---

TYTO-288: hovering a tab shows the folder its file is saved in, with the home directory written
`~` — for a brief, for the preview of a brief, and for `settings.json`, `keybindings.json` and
`snippets.json`. An untitled tab shows nothing. The folder comes back with a tab restored from
the last session. It is for display only: the window cannot open a file by it (ADR 0086).
