---
'@tyto/command-line': minor
'@tyto/core': minor
'@tyto/export-html': patch
---

`tyto render --guide` writes the layered PSD guide of a template's external art (ADR 0221):
`<artwork>-<format>.psd` for the piece and `<slot>-<format>.psd` for each inline picture,
with the PSD exporter registered among the built-ins and each layer's PNG decoded for it. A
template that declares no external art is the new fatal `E_GUIDE_NO_EXTERNAL_ART`, and
`--types psd` without `--guide` is refused. `export-html` no longer draws a hidden text node,
whose flex box undid its `display: none`.
