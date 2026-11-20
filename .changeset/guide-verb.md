---
'@tyto/command-line': minor
'@tyto/core': minor
'@tyto/cli': patch
---

`tyto guide <brief>` writes the PSD guide of each external-art file the brief cites beside
that file, named after it (ADR 0222): `grafico.guide.psd` for one format,
`grafico.<format>.guide.psd` per format for several. Missing guides by default, `--all`,
`--only`, `--list` (writes nothing), `--force` and `--open`. A guide newer than the brief is
the new fatal `E_GUIDE_NEWER_THAN_BRIEF` without `--force`. `guideCandidates`, `guidePaths`,
`guideOverwrite` and `writeGuides` are exported for the window.
