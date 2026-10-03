# Format kinds and format names

This document is read by designers **and by AI agents**. Be literal.

A format is a canvas: a size in `formats.yaml`, the one place a number like 1080×1350 is
written (`docs/template-authoring.md`). This says what each format is **for** and how it is
**named**, so the ids a brief writes read the way the house talks about its pieces. ADR 0051
is the decision; TYTO-194 made it.

## The kinds

Every format names one `kind`, from a closed list:

| `kind`       | the canvas of      |
| ------------ | ------------------ |
| `grid`       | a post in the feed |
| `story`      | a story            |
| `banner`     | a banner           |
| `capa-ebook` | an e-book cover    |
| `thumbnail`  | a video thumbnail  |

The list is closed so that a filter on it cannot drift the way slot names once did
(`docs/slot-vocabulary.md`). Growing it is a change to this document and to `FORMAT_KINDS` in
`packages/core/src/config/formats.ts`, together.

`capa-ebook` and `thumbnail` have no format in the built-in pack yet: their sizes are not
known. Each gets one when its first template arrives, as `banner` did with the product banner
(TYTO-210).

## The piece a template makes is derived, never written

A **carrossel** is several grids in sequence, and **stories** are several stories chained.
That half is not a kind: it is whether the template runs across several artworks, which its
manifest already says by having a repeatable slot (`lamina`).

| the format's `kind` | the manifest repeats? | the piece |
| ------------------- | --------------------- | --------- |
| `grid`              | no                    | grid      |
| `grid`              | yes                   | carrossel |
| `story`             | no                    | story     |
| `story`             | yes                   | stories   |
| any other           | either                | the kind  |

`pieceKinds(manifest, catalogue)` in `packages/core/src/template/piece-kind.ts` is this table.
A template that declares two formats makes two pieces: `promo-curso` is a grid and a story,
`carrossel-lista` a carrossel and stories. A template that _can_ repeat is a sequence even when
one brief writes a single `lamina` — the table answers what the template makes, before any
brief is read.

## The naming rule

**A kind's standard size is named by the kind alone. An unusual size carries its proportion,
written `WxH`.**

| id               | size        | why                                          |
| ---------------- | ----------- | -------------------------------------------- |
| `grid`           | 1080 × 1350 | the house's standard post, 4:5               |
| `grid-1x1`       | 1080 × 1080 | the square post, which the house uses rarely |
| `story`          | 1080 × 1920 | the only story size                          |
| `banner`         | 1200 × 628  | the house's standard banner                  |
| `banner-1x1`     | 600 × 600   | the square banner                            |
| `banner-345x146` | 345 × 146   | the small strip a product page shows         |

`feed` and `retrato` are not used: they were the platform's words, not the house's. TYTO-194
renamed them (`feed` → `grid-1x1`, `retrato` → `grid`), and a brief that still writes them is
told the format is not defined.

A project's own `formats.yaml` may name its formats anything the id rule allows; this rule is
what the built-in pack follows and what a new format should follow.
