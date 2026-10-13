---
'@tyto/editor': minor
'@tyto/desktop': minor
---

TYTO-276: a "/" at the start of a line lists templates. `@tyto/editor` exports `slashCompletion(sources)`, `completeSlash`, `openSlashMenu` and the `slashRequested` effect: a "/" in column 0 of a brief, outside the frontmatter and with nothing after the cursor, opens a list of the rows each `SlashSource` hands it; typing filters, Enter replaces the "/" and the query, Escape leaves the "/", and `//` stays a comment. The desktop lists its templates there — the skeleton into a brief holding only the "/", or a switch of `template:` in one undoable edit on a brief with content, the row saying which — and registers `editor.insertMenu`, brief-only and with no default key, to open the same list from a binding in `keybindings.json`.
