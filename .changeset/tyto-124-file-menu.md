---
'@tyto/desktop': minor
---

TYTO-124 — the File menu carries the app's own verbs, there is a New, and a save that fails
says so.

Three things a person meets in the first five minutes, which is why they were one card.

**The File menu.** It used to be `{ role: 'fileMenu' }`, whose entire content on Windows and
Linux is Quit — and on macOS is _Close Window_ on `Mod-W`, the one accelerator this app removes
on purpose, so macOS had no File menu at all. Open, Save, Save as and Export all existed and
answered only to `Ctrl+K` or a keystroke somebody had to already know. They are now in the menu,
on all three platforms, each one running **the same command the command bar runs**: the ids live
in one table both processes read, main sends the id across and the renderer calls the registry.
Nothing in the browser process knows what any of them does.

**New.** There was no such verb. The only way to reach an empty tab was to close the last one and
let the window replace it — a side effect standing in for a command. `Ctrl+N` and File ▸ New now
add a tab without disturbing any other; the rule that lets an empty untitled tab be replaced when
you open a file is untouched, and deliberately not consulted here, or a New pressed on a blank
tab would open nothing.

**A failed save.** A rejected write — full disk, read-only folder, a path that vanished — became
an unhandled rejection: a line in a log file, and on screen nothing but the unsaved dot, which
was already lit and so said nothing new. It is now a row in the problems panel naming the file
and the reason the system gave, in the window's language. The panel rather than a dialog,
because that is where _why is this not working_ already goes and because the quit question is
meant to be the only box that interrupts.

Two smaller consequences. The menu is **rebuilt when the footer changes language** — it was built
once in the system's locale, which cost one wrong word when it carried one string and would cost
five now. And **no File item carries an accelerator**: a menu accelerator is handled before the
page sees the key, so one there would fire in vim mode too, where `Ctrl-N` and `Ctrl-O` belong to
the vim engine.

What it does not do: no right-click menu, no recent-files list inside the menu, and a save that
failed is not retried on its own.
