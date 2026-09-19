---
'@tyto/desktop': patch
---

TYTO-150 — every version of the app now keeps its data in its own folder, so a build you download
cannot open with the one before it still in it.

Until now the packaged portable, the installed build and `electron-vite dev` all wrote to a single
folder per machine, which is the opposite of what the `portable` target exists for: a build meant
to run beside another version of itself opened with that version's layout, recent files and
settings, and a tester could not tell the behaviour they were looking at from residue. The data
now lives in `<appData>/Tyto/<version>/` — `%APPDATA%\Tyto\0.3.0` on Windows,
`~/Library/Application Support/Tyto/0.3.0` and `~/.config/Tyto/0.3.0` on the other two — and the
five things that folder holds (logs, settings, recent files, credentials, layout) move with it.

The product root is a literal and not `app.getName()`, which settles the question TYTO-149 opened.
`getName()` answers with the package name, `@tyto/desktop`, while electron-builder ships
`productName: Tyto` — read out of the shipped 0.3.0's `app.asar` rather than off a config file —
and that is how a release body could send beta testers to `%APPDATA%\Tyto\logs` while the app
wrote to `%APPDATA%\@tyto\desktop`. A test reads `electron-builder.yml` so the two cannot drift
apart again. `docs/releases/desktop-v0.3.0.md` is corrected to the folder the shipped 0.3.0 really
uses rather than to this one, because it describes a binary people already hold.

The path is set at module scope, before `app.whenReady()`, and that is measured rather than
stylistic: moving it after ready leaves a Chromium `Local State` file behind in the old folder.
`--user-data-dir` is honoured wherever it is passed, which is what keeps fourteen end-to-end
suites isolated from each other.

Anybody on a version before this one keeps their data where it is, and nothing here reads it.
Bringing settings across from the previous version is the next card, and the auto-updater waits on
that one: an update that silently moves somebody into an empty folder is worse than no update.
Credentials are part of what does not travel — `safeStorage` ciphertext lives in the folder that
moved, so a new version asks for them again.

Decided in ADR 0032.
