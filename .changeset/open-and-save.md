---
'@tyto/desktop': minor
---

TYTO-99 — open and save `.brief` files, and the folder that comes with one

Until now the Tyto window could compile a brief and show it, and could not keep it: close
the app and the text was gone. This adds opening, saving and a recent list — and, because a
file has a folder, it is also what makes a brief's images appear.

**Main holds the path and the renderer never does.** The renderer asks to open something and
gets back text and a name; where the file is stays in main, which is the only side with a
disk. That is not ceremony: it is what lets the preview resolve `assets/logo.png` without the
renderer ever learning a folder. The one place a path crosses the bridge is a recent entry,
and main refuses any path that is not already in the list it wrote — so a renderer asking for
a file nobody offered gets the same answer as one asking for a file that was deleted.

**The recent list is commands, not a menu.** E9.12 built the list a person types into; ten
files are ten entries in it, reachable with `Mod-K` and no panel open. An entry whose file has
moved is reported in the problems panel — the same place every other "why is this not
working" already goes — rather than vanishing on the one click that would have explained it.

**Images start working, and that took two ports rather than one.** Resolving told `resolve`
that `assets/logo.png` exists; the exporter still had nothing to embed and reported
`E_EXPORT_ASSET_UNRESOLVED` for a file that was right there. Reading the bytes between
`compile` and the export is the other half, and the end-to-end suite is what found it.

`Mod-s` finally does something: `@tyto/editor` has bound it to `editor.save` since E8.3 and
no host had registered the command. `Mod-o` and `Mod-Shift-s` are the desktop's own
additions — and deliberately **not** offered in vim mode, where `vimMode()` replaces the
whole input layer, so the command bar shows no shortcut for them there rather than promising
one that does nothing.

The window title carries the file name and says `(não salvo)` in words rather than with a
bullet, which is nothing at all to a screen reader.
