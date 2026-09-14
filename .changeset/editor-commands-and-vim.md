---
'@tyto/editor': minor
---

Command registry, keymap layer and vim mode (TYTO-38).

`createCommandRegistry()` is the Command pattern `docs/architecture.md` puts in the editor:
every action has an id, keymaps bind ids rather than functions, and E7 hands a plugin the
same `register` the built-ins use. A binding to an id nobody registered falls through
instead of failing, so shipping a `Mod-s` binding before anybody implements saving costs
nothing.

**There is one undo stack, and CodeMirror's history is most of it.** A command that changes
something outside the document declares an `undo` and joins the stack; the text history's
own `undoDepth` is the clock that keeps the two in order, so nothing here counts keystrokes
and nothing can disagree with CodeMirror about how many events a burst of typing was. A
command that edits the document must **not** declare an `undo` — the history already owns
text, and the registry throws rather than letting an undo overshoot by one edit.

`vimMode()` brings `@replit/codemirror-vim` (ADR 0006) in through the same registry: `:w`
and `:render` are ex-commands that dispatch ids, and the engine's `u` and `Ctrl-r` are
pointed at the registry so vim does not get a second, shallower undo that skips app-level
commands. `EditorHandle` gains `runCommand`, `setVimMode` and `isVimMode`; the toggle is a
compartment reconfigure, so the document, the cursor and the undo stack all survive it.

`EditorOptions` gains `commands`, `keymap` and `vim`. `defaultKeymapSet` and `vimKeymapSet`
are the two built-in sets.
