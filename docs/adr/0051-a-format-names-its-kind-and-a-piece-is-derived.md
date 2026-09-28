# 0051 — A format names its kind, and the piece a template makes is derived

Status: accepted · 2026-09-28 · TYTO-194 · amends ADR 0020's formats file

## Context

On 2026-09-27 the maintainer asked for templates to be told apart by brand and by "tipo de
peça". Asked what a piece kind is, he listed the house's own words on 2026-09-28: grid,
carrossel ("vários grids em sequência"), story, stories ("múltiplos encadeados, similar a um
carrossel"), banner, capa de e-book, thumbnail.

Two facts already had a home. The **canvas** is a size in `formats.yaml`, and the **sequence**
is whether a manifest has a repeatable slot. Measured on the four built-in templates, the three
with a repeatable `lamina` are carousels and the one without is a single post: 4 of 4.

What was missing was which family a size belongs to. Two sizes are grids (1080×1350 and
1080×1080), and nothing tied either to "grid". The ids were also the platform's words (`feed`,
`retrato`), which the maintainer asked to stop using.

## Decision

**A format names its kind.** `formats.yaml` entries gain an optional `kind` from a closed list:
`grid`, `story`, `banner`, `capa-ebook`, `thumbnail`. It is optional so that a project's file
written before this still loads. The built-in pack names one on every format, and the contract
test pins that.

**The piece a template makes is derived, never declared.** `pieceKinds` reads the format's
kind and the manifest's repeatable slot: a repeating `grid` is a `carrossel`, a repeating
`story` is `stories`. A `kind` on the manifest was considered and refused. It could only ever
disagree with the manifest it sat in, and a template declaring two formats would have to state
its kind twice.

**Format ids are named by kind.** A kind's standard size is the kind's name alone, and an
unusual size carries its proportion. So `retrato` became `grid` (the house standard, 4:5),
`feed` became `grid-1x1` (square, rare), and `story` stays. The maintainer set the rule on
2026-09-28: the unusual one carries the scale, the standard one is just `grid`.

The subject of a piece (an agenda, an approved list) is not a field: it is the template's name.

## Consequences

It is a breaking change for briefs and scripts, and nothing else moves:

- All four built-in templates take a major version.
- A brief that writes `formats: [retrato]` or `[feed]` is told the format is not defined.
- Output files are renamed: `lamina-1-retrato.png` → `lamina-1-grid.png`, `artwork-1-feed.png` →
  `artwork-1-grid-1x1.png`.
- Every built-in example renders pixel-identical to the previous ids: 14 of 14 files, 0 pixels
  different.

**An installed plugin's template that declares `feed` stops rendering against the built-in
catalogue.** The desktop app uses the pack's `formats.yaml` unless a project folder brings its
own. The example plugin pack and `tyto plugin new` were moved to the new ids. A third-party pack
has to follow, or ship a project `formats.yaml` that defines its ids.

The export dialog still shows format ids, not their `label`: showing labels is a change to the
`templates:list` channel, and it is left to a card of its own.
