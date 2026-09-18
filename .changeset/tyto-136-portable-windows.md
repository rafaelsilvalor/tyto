---
'@tyto/desktop': minor
---

TYTO-136 — a `desktop-v*` release now carries a portable Windows build beside the installer.

Windows was the only platform whose artifact could not be run without installing: Linux ships
an AppImage and macOS a `dmg`, both of which already give you something runnable. The
`portable` target adds one self-extracting `.exe` that runs from wherever it sits — measured
at 112 216 510 B beside the installer's 112 383 465 B, from the same 390 134 058 B tree, with
no filename collision (`Tyto 0.2.0.exe` against `Tyto Setup 0.2.0.exe`).

macOS and Linux are untouched, and `desktop-release.test.ts` now pins all four targets, so
dropping the portable and quietly giving another platform a second artifact both fail.
