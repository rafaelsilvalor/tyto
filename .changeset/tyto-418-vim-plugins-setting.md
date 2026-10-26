---
'@tyto/editor': minor
'@tyto/desktop': minor
'@tyto/docs': patch
'@tyto/repo-checks': patch
---

TYTO-418 (ADR 0143): vim mode gains its first plugin, commentary, and a `vimPlugins` setting
that switches each vim plugin by id. `@tyto/editor` ships a `comment` operator (CodeMirror's
`toggleComment`, so a Markdown or template line is wrapped in `<!-- -->` where vim's own
`gc` does nothing; Markdown's comment tokens now reach it), passes an operation's `isEdit` to the engine so `.` repeats an action, and hands a
mapping's `<character>` key to the operation as `selectedCharacter`. The desktop's built-in
plugin contributes commentary on `gc` through `editor.vim`, the window reads every contribution
on `plugins:vim` and maps the ones the setting leaves on, which is all of them unless one is
named `false`; a save of `settings.json` switches them in place. The manual's Vim mode page gains
a Plugins section, in English and Brazilian Portuguese.
