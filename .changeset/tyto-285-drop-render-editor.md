---
'@tyto/editor': minor
---

TYTO-285: remove `EDITOR_RENDER` (`editor.render`), its `Mod-Enter` binding in both keymap sets and the `:render` ex-command. It was a placeholder from before the preview drew live, and no host ever registered it, so the key fell through to CodeMirror's `insertBlankLine` and `:render` did nothing. Removing a public export is a minor bump before 1.0. A host that wants a render command registers its own id and binds it.
