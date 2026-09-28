---
'@tyto/templates': major
'@tyto/core': minor
'@tyto/cli': minor
'@tyto/template-lang': patch
---

TYTO-194: formats are named by piece kind, and each format says which kind it is (`docs/format-kinds.md`, ADR 0051).

**Briefs must be edited.** The built-in pack's `retrato` is now `grid`, and `feed` is now `grid-1x1`; `story` is unchanged. All four built-in templates take a major version (`agenda-semana` 4.0.0, `aprovados` 4.0.0, `carrossel-lista` 3.0.0, `promo-curso` 3.0.0). A brief that still writes the old ids is told the format is not defined.

```
before                          after
formats: [retrato]              formats: [grid]
formats: [feed, story]          formats: [grid-1x1, story]
lamina-1-retrato.png            lamina-1-grid.png
artwork-1-feed.png              artwork-1-grid-1x1.png
```

The pixels are unchanged: every built-in example renders identical to the previous ids, 14 of 14 files, and only the file names change.

`formats.yaml` entries gain an optional `kind` (`grid`, `story`, `banner`, `capa-ebook`, `thumbnail`), and `@tyto/core` exports `pieceKinds`, which derives what a template makes from its formats and whether it repeats: a repeating grid is a `carrossel`, a repeating story is `stories`. `tyto template new` and `tyto plugin new` scaffold `grid` by default. An installed plugin whose templates declare `feed` needs a project `formats.yaml` that defines it, or its own ids moved to the new names.
