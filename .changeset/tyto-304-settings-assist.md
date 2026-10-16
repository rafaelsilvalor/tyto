---
'@tyto/desktop': minor
---

TYTO-304: the `settings.json` tab suggests as you type. A quote where a key goes lists every
setting not yet in the file, with what it does; picking one writes it with its default selected.
Inside a value it lists the values that setting accepts — `vimModeStyle`'s `badge`, `border` and
`bar`, `true`/`false`, the installed themes — and inside `statusBarItems` and `statusBarColors`
the item ids and colour keys not yet written. Hovering a key shows its description, type,
default and accepted values. It works with vim on, in insert mode, and the file's warnings are
unchanged.
