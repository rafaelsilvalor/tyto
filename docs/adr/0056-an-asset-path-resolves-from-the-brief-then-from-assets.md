# 0056 — An asset path resolves from the brief, then from `assets/`

Status: accepted · 2026-09-29 · TYTO-204 · amends the task folder's asset rule under ADR 0011
(`docs/render-contract.md`, `fsInbox`), which made `assets/` the only base when it existed

## Context

The maintainer's first test of real briefs in the desktop app, on 2026-09-29: one folder with
six briefs, `assets/calendario.png` and `assets/selo.png`. `tyto render` drew both images in 6 of
6 briefs. The desktop editor reported `E_ASSET_NOT_FOUND` for `./calendario.png` and drew neither.

Two rules were in force. The CLI (`assetBaseFor`) and the inbox (`fsInbox`) used `assets/` beside
the brief as the **only** base when that folder existed, and the brief's folder otherwise. The
desktop's preview and export box used the brief's folder only. So one folder rendered in one
surface and lost its images in the other, and neither rule accepted `./assets/selo.png`
everywhere: the CLI read it as `assets/assets/selo.png`.

## Decision

**An asset path is the path as written in the brief, read from the brief's folder first. If
nothing is there, the same path is read from `assets/` beside the brief.** If both exist, the
literal one wins. The maintainer chose this on 2026-09-29.

- `./assets/selo.png` finds `assets/selo.png`, and `./selo.png` finds `selo.png` beside the brief.
- `./calendario.png` with the file only in `assets/` still resolves, through the fallback, so
  Jacurutu's task shape (ADR 0011) keeps working unchanged.
- **Each folder is its own containment root.** A path that climbs out of the brief's folder is
  refused and is not retried in `assets/`, and a path that climbs out of `assets/` is refused
  there. Since `assets/` is inside the brief's folder, nothing outside the brief's folder is
  ever read.
- **The resolved `AssetRef.path` differs by folder; the hash does not.** The hash is the bytes'
  (ADR 0003), so the same image renders to the same artwork whichever folder it came from.
- `E_ASSET_NOT_FOUND` names both places: "…relative to the brief at '{base}', nor in its assets/
  folder."

**One resolver, in `@tyto/io`:** `briefAssetResolver({ briefDirectory })`, over
`fileAssetResolver`'s new ordered `fallbacks`. Every surface builds its resolver there: `tyto
render`, `tyto watch`, the desktop queue, the desktop preview, the export box, and the template
editor's brief preview. No app keeps its own rule.

**`tyto render --assets <dir>` is the one exception, and it is explicit:** the named folder is the
only base, with no fallback, because the person said where the files are.

`BriefTask.assetBase` is renamed `briefDirectory` and now always holds the brief's folder, because
it no longer names _the_ base. `BriefTask` is `@tyto/io`'s, not `plugin-api`'s: no plugin sees it.

## Consequences

A delivery-shaped folder renders the same in the CLI and in the app, with the images named
either way. A brief that relied on `assets/` hiding a same-named file beside it now gets the one
beside it. None of the 39 `.brief` files in the repository sits beside a file of the same name
as one in its `assets/`; a person's own folders were not measured.

Not covered: an image in any other folder resolves only when the brief writes its path, from the
brief's folder. There is no search path beyond these two.
