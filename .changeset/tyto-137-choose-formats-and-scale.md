---
'@tyto/desktop': patch
---

TYTO-137 — the export dialog can now choose which formats to render, at 1× or 2×, and how hard
to compress the lossy types. Until now it rendered every format the template declares, at scale
1, with quality 90 that nobody picked.

**Three controls, and the defaults are exactly today's behaviour.** Open the dialog, click
Export, and the request that goes out is byte-identical to the one before this card: every
format ticked, no scale, quality 90.

- **Formats** — a checklist of the formats this brief's template declares, all ticked. Untick
  `story` and only the feed frames land. Unticking all of them disables Export, the same way
  unticking every file type already did: an export of no formats is an export of nothing, and
  it must not be read as "all of them".
- **Scale** — 1× or 2×, and it only appears when a type made of pixels is ticked. 2× is the same
  design at twice the resolution, not a design given twice the room.
- **Quality** — 1-100 for JPEG and WebP. It only appears when one of those two is ticked, so
  asking for quality on PNG is impossible from the form rather than refused afterwards: the
  raster port throws a `TypeError` for it, because PNG is lossless and a caller who thought it
  had asked for a smaller file deserves to be told it had not.

**Nothing in main changed, and no channel was added.** `export:start` has accepted `formats` and
a per-output `scale` since TYTO-43; this fills in two fields the window was leaving empty. The
format list is a lookup rather than a round trip — `templates:list` already answers with each
template's format ids and the window is holding that answer, so the dialog is handed the list
for the template the brief names. A brief that names no template, or one whose manifest this
window does not have, keeps the note that says every format will be rendered, which is what the
request will do.

**Measured through the window, in the files that landed.** `promo-curso` declares `feed` and
`story`: unticking `story` and exporting PNG produced one frame at 1080×1080 (the count says a
format was dropped, the size says which one), and the same export at 2× produced 2160×2160. Both
are new end-to-end cases; the suite is otherwise SVG on purpose, and this is the exception the
criterion requires, since an SVG has no pixels to double.

Two things it deliberately does not do: it does not remember the choices between exports, and it
does not re-read the checklist while the dialog is open — the brief behind a modal cannot be
typed in, and a checklist rebuilding itself under somebody's hand would be worse than one that
does not.
