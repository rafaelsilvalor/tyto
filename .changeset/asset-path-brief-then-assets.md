---
'@tyto/io': major
'@tyto/cli': minor
'@tyto/core': patch
'@tyto/desktop': patch
---

TYTO-204: an asset path in a brief is read as written, from the brief's folder first, and from `assets/` beside the brief when nothing is there (ADR 0056). The same rule holds in `tyto render`, `tyto watch`, the desktop queue, preview, export box and the template editor's preview, so a folder with its images in `assets/` renders the same in the CLI and in the app. `./assets/logo.png` now resolves everywhere, and when a file of the same name exists both beside the brief and in `assets/`, the one beside the brief wins. `tyto render --assets <dir>` still names the one folder searched, with no fallback. `E_ASSET_NOT_FOUND` now says it looked in `assets/` too.

`@tyto/io` migration: `BriefTask.assetBase` is now `briefDirectory` (the brief's folder); resolve assets with `briefAssetResolver`.
