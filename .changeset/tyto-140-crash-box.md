---
'@tyto/desktop': minor
---

TYTO-140 — a crash says so on screen again, and for the first time when it happens at startup.

The log card traded a box for a line without meaning to. Electron draws its own error box for
an uncaught exception **only while nothing else is listening**, and `installCrashHandlers`
started listening — so a crash in main became something written down and invisible. Measured
this time rather than read: Electron's default handler opens with
`process.listenerCount("uncaughtException")>1||…`, dumped at runtime from the Electron this
repo installs.

`installCrashHandlers` now takes an `onCrash` port and the composition root supplies
`dialog.showErrorBox`, which keeps `log.ts` free of Electron and unit-testable. The box carries
the error's first line and **the path of the log folder**, because that folder is what a tester
is asked to send. It is called inside a `try`: it runs where a raised exception is fatal, and a
box that failed to draw would turn a reported crash into a silently killed process — worse than
the state this started from.

**The bigger half is the one the card's title does not say.** A `throw` during startup is a
rejected _promise_, and Electron runs with `--unhandled-rejections` in `warn` mode, so that path
never reached Electron's box — before the log card or after it. It is also the path that has
actually failed in a packaged app, and what it looks like is a double-click that does nothing:
no window, no box, a process alive and invisible, and a log line sitting in a folder whose only
door — Help ▸ Open the log folder — was built last, after everything that can fail. Two changes
close it: a `.catch` on `app.whenReady().then(start)`, and the application menu built **first**,
before the settings, the sources, the preview, the catalogue and the export. The menu needed
none of them; it only needed to be asked earlier.

The box follows the window's language rather than the system's, over the channel the File menu
card added. Three catalogue strings arrive with it, one of them for the case where `fileLog`
itself failed — a box naming a folder that was never written would send somebody looking for a
file that is not there.

What it does not do: it does not prevent the crash and it does not recover what was open. It
makes sure the person knows it happened and has something to send.
