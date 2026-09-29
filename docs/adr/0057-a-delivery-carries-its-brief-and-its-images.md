# 0057 — A delivery carries its brief in `editaveis/` and its images in `assets/`

Status: accepted · 2026-09-29 · TYTO-205 · extends TYTO-121's delivery layout, ADR 0054's
leftover rule and ADR 0056's asset rule

## Context

On 2026-09-29, testing real briefs in the desktop app, the maintainer asked for an export shaped
like what the team sends out:

```
<the folder picked>
  <format>-<NN>.<ext>     the artwork
  editaveis/              the brief
  assets/                 every image the brief used
```

Three layouts existed and none was this. `tyto render --out` is flat — artwork and
`result.json` — and is the ADR 0011 contract Jacurutu reads, so it must not move. `tyto render
--folder` (TYTO-121) wrote the artwork and an `editaveis/` with the brief, but under a
`<brief-name>/` level and with no images. The desktop's export box was flat like `--out`. No
layout copied an image: each was embedded in the artwork and nowhere else, and no decision said
either way.

Asked which images, the maintainer answered **only what the brief brought** — `imagem:`,
`selo:`. The marks a template draws from its own code (the owl, the speech balloon) stay inside
the artwork.

The copied brief has to render from `editaveis/`, and ADR 0056 had just made each asset folder
its own containment root: a path that climbs out of the brief's folder is refused, and not
retried. Rewriting the copy to `../assets/selo.png` would be exactly such a path.

## Decision

**A delivery writes the artwork at its top, the brief in `editaveis/`, and the brief's images in
`assets/`.** Each image is copied by its own file name; a second, different file with the same
name gets `-2`, `-3` before the extension, compared without case. The same file named twice by
the brief is copied once. What is copied is what the compile resolved — a recorder around the
asset resolver — never a second reading of the frontmatter.

**The copied brief's image paths name the copies.** Only frontmatter values that are exactly a
path the brief resolved to an image change, to the copy's bare name (`selo: ./fotos/selo.png`
becomes `selo: selo.png`). An image slot is always written in the frontmatter, so nothing else
needs touching; comments and the body are left byte for byte, even where they mention the same
file. The key, spacing, quotes and line endings stay as written.

**A brief in a folder named `editaveis` reads a third folder: `../assets`.** It comes after the
brief's folder and `assets/` beside it (ADR 0056), and it is its own containment root like
them: a path that climbs out of any of the three is refused, and a path that climbs out of
`editaveis/` is refused there and not tried in the others. So `editaveis/<name>.brief`, now
naming `selo.png`, finds the delivery's `assets/selo.png` in the CLI, `tyto watch`, the desktop
preview and the export box — every surface that builds its resolver with `briefAssetResolver`.

**This is a heuristic, and its limit is stated here plainly: the folder's name is the only
signal.** Any folder a person happens to name `editaveis` gains `../assets` as a place images
are read from, whether or not Tyto made it. That folder is inside whatever contains
`editaveis/`, so nothing outside a folder the person already opened a brief from becomes
readable; the cost is that an image beside a same-named folder of theirs can be found where
they did not expect it. It was preferred to a marker file (one more thing to lose when a folder
is copied by hand) and to a brief key (the brief language has none for it, and a delivery would
be the only writer).

**`E_ASSET_NOT_FOUND` names the folders actually searched**: one under `tyto render --assets`,
two by default, three for a brief in `editaveis/`. The port carries them as `searched`.

**Leftovers reach `assets/`** (ADR 0054's rule): an image the previous delivery's brief pointed
at in `assets/` and this one does not is removed, with a `W_LEFTOVER_REMOVED`. The previous
brief in `editaveis/` is the record, read before it is replaced; a file the brief never named
is left alone.

**The desktop's export box delivers into the folder picked; `tyto render --folder` keeps its
`<out>/<brief-name>/` level.** In the window the person has chosen the folder that is the
delivery; on the command line `--out` names a parent many briefs share. `--out`, the queue and
`tyto watch` are unchanged: their `out/` is the ADR 0011 contract.

**Not copied, deliberately:** fonts (CircularXX is licensed to a machine, not to a folder), the
template (a pointer, never a copy — `template.txt`), and marks drawn from template code.

## Consequences

A delivery is self-contained for everything a person would edit: open `editaveis/<name>.brief`
and it renders, to the same bytes, from the images beside it. Measured through the CLI:
`--folder`, then rendering the copied brief, produced byte-identical SVGs.

A person who renames `editaveis/` loses the third folder, and the copied brief then reports
`E_ASSET_NOT_FOUND` naming the two folders it searched — which says what to do.

An image named only in a comment or the body is not copied, because it is not an image of the
artwork.
