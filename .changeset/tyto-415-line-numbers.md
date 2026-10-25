---
'@tyto/editor': minor
'@tyto/desktop': minor
---

TYTO-415: a `lineNumbers` setting, as VS Code's `editor.lineNumbers`. `"on"` (the default)
numbers each line, `"relative"` shows the cursor's line its own number and every other line its
distance to it — what a vim count like `5j` moves — and `"off"` shows no numbers. It applies on
save of `settings.json`, in every tab and the template mode, with or without vim.
