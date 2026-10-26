---
'@tyto/editor': minor
---

TYTO-422 (ADR 0142): a vim contribution can map keys onto a text object. `defineVimOperation`
takes a third kind, `{ kind: 'textObject', select(view, head, args, count) }`, which answers
`{ from, to, linewise }` around the cursor and is registered as an engine motion, so `d`, `c`,
`y`, visual mode, counts and `.` treat it as they treat `ip`. The editor ships two:
`indentObject` (`ii`/`ai` in vim-indent-object's sense, a count climbing one level out) and
`entireBuffer` (`ie`/`ae`). A text object mapped outside `visual` and `operatorPending`, and
any mapping of `i` or `a` followed by two keys or more (`in(`), is refused with
`E_VIM_CONTRIBUTION`, because vim's own `i` and `a` would always match first. No built-in plugin
maps them yet (TYTO-419).
