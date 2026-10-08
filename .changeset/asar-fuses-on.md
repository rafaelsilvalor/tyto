---
'@tyto/desktop': patch
---

The packaged app now checks its own `app.asar` and loads only from it (TYTO-241, ADR 0067).
Electron's `EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar` fuses are on, so on
Windows and macOS an archive changed after packaging refuses to start, and an `app/` folder put
beside the archive is never loaded. Linux packages carry no hash, so there the archive is not
checked.
