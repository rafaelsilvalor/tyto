---
'@tyto/desktop': patch
---

TYTO-149 — the app writes one line when it starts, so the log folder a beta tester is asked for
exists from the first run instead of only after something has already been written down.

The whole beta support story is _if something breaks, send me the log folder_: it is in the
release body, it is the one item in the Help menu, and TYTO-140 ships a crash box whose job is to
name it. `fileLog` creates its folder on the first write and not before, which is the right
behaviour on its own — a log that needed somebody to create its own folder would write nothing on
the machine it matters most on. The consequence was that the folder was missing after exactly the
failure that needs it most. An app that starts cleanly and then hangs has logged nothing, so
Help ▸ _Open the log folder_ opened nothing, and a tester following the release body found a path
that was not there and had nothing to send.

Measured on the shipped 0.3.0 portable rather than read off a config file — launched from
`release/win-unpacked` and left running, with `Local State`, `Preferences` and `blob_storage`
touched under `%APPDATA%\@tyto\desktop`, no `%APPDATA%\Tyto` in existence, and no `logs/` folder
at all.

The line carries the version, the platform and a timestamp, which is what dates the session a
report is about. It does not reopen the synchronous-write trade `log.ts` defends: one write per
process launch, before a window exists.

`docs/releases/desktop-v0.3.0.md` now says plainly that on that version a missing `logs` folder is
itself the answer — the app stopped before it could write anything — because that release is
already in testers' hands and this change cannot reach it.
