---
'@tyto/desktop': minor
---

TYTO-304: the `keybindings.json` tab suggests as you type. Inside an entry, a quote lists the
fields `key`, `command` and `when` not yet written; a `command`'s value lists every command id
with the title the command bar shows, then `-<id>` for each one with a default key to remove;
a `when`'s value lists the six contexts with what each means. Hovering a command's id shows its
title and default key, a context what it means, and a field name what the field is. It works
with vim on, in insert mode, and the file's warnings are unchanged.
