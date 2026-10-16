---
'@tyto/editor': minor
'@tyto/desktop': minor
'@tyto/theme-pack': minor
---

TYTO-293: the editor draws a thin vertical guide at each indent level, as VS Code does, and the
guide of the block holding the cursor in a stronger colour. A blank line inside a block keeps
the guide; one between two blocks breaks it. The guides appear in brief tabs, the JSON tabs
(settings, keybindings, snippets) and both buffers of the template mode. `"indentGuides": false`
in `settings.json` hides them on save, with no restart. Two theme tokens are new,
`indent-guide` and `indent-guide-active`, set by every built-in and pack theme (42 tokens).
