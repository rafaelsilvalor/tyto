# 0160 — A slide carries its own slots

Status: accepted · 2026-10-30 · TYTO-482 · extends the manifest's slots (`docs/template-authoring.md`)
and ADR 0035 (a hole is drawn); builds on ADR 0056 (where a brief's images are read) and ADR 0158

## Context

On 2026-10-30 the `tyto-template-questao-estrategica` template (TYTO-477) needed a picture on
each slide of a carousel. A manifest could not say so. The one repeatable slot (`lamina`) makes
one artwork per occurrence, but every other slot is set once for the whole brief: a second
`::imagem` is `E_BAD_SLOT_VALUE` ("set more than once"). The template declared `imagem-1` …
`imagem-4` and let each slide pick one with `{imagem: N}`, which caps the carousel at four
pictures and makes the person number them twice.

**What existed at `origin/main` eca9871, read in the code.** `resolve` kept a brief-wide
`slots` map and one `ResolvedArtwork { index, slot }` per occurrence; `compile` handed each
artwork `{ ...slots, lamina: thisOccurrence }`. An adjustment is a flag or an enum, and its
value is `[a-zA-Z0-9_-]+` in the grammar, so a path cannot be one.

Two syntaxes were put to the maintainer: a path as an adjustment on the slide's line
(`::lamina {imagem: ./foto.png}`, a grammar change), and a slot written after the slide it
belongs to. He chose the second, and asked that the way stay open to a slide with several
pictures placed among its lines.

## Decision

**A slot may declare `per: <the repeatable slot>`**, and then it belongs to each occurrence:

```yaml
slots:
  lamina: { type: rich-text, repeat: true, min: 1 }
  imagem: { type: image, per: lamina }
```

```
::lamina
  Primeira questão
::imagem ./questao-1.png
```

1. **A `per` slot goes to the occurrence written last before it.** No grammar change: the
   parser already reads `::imagem` as a directive, and only `resolve` knows it belongs to a
   slide. It lands in `ResolvedArtwork.slots`, never in the brief-wide map.
2. **One per slide, written in the body.** Before any occurrence, a second one for the same
   occurrence, or a frontmatter key, it is `E_BAD_SLOT_VALUE` at its own range. Several
   different `per` slots may belong to one slide (`imagem` and `foto`).
3. **Its value resolves like the same slot would anywhere else.** An image goes through the
   brief's `AssetResolver` — same folders, same confinement (ADR 0056), same `size`
   (ADR 0158) — and a missing file is `E_ASSET_NOT_FOUND` at that `::imagem`. `Scene.assets`
   lists it once, as it lists every other image.
4. **A template reads it under its name.** `compile` merges the occurrence's own slots over the
   brief's for that artwork, so `context.slots.imagem` is this slide's picture, as
   `context.slots.lamina` is this slide's text. Nothing new crosses to a template.
5. **`required` means every slide.** A slide without one is `E_MISSING_REQUIRED_SLOT` at that
   `::lamina`, and only that slide's frames carry the gap stamp (ADR 0035):
   `ResolvedArtwork.missingRequiredSlots` holds the names, and the brief-wide list stays for the
   brief's own slots.
6. **The manifest checks it.** `per` must name the repeatable slot; a `per` slot does not repeat
   and takes no `default`, because a value nobody wrote has no slide to belong to.
7. **No protocol bump.** A template call already carries `slots` as a loose record, so a slide's
   own slots reach a template in a plugin's process without a new field; a manifest that
   declares `per` is checked by the host that registers it, which has to be this one or later.

**How it extends, without breaking any of the above** — the maintainer's next ask, not built
here:

- **Several pictures on one slide** is a `per` slot that also declares `multiple: true`: each
  `::imagem` after the same `::lamina` adds one, in order, instead of being refused. A slot
  without `multiple` keeps rule 2.
- **Where among the slide's lines a picture goes** needs the slide's body to continue after
  an `::imagem`. Every `per` value keeps its source `range`, and so does every line of the
  occurrence's body, so the order "body, picture, body" is already recoverable from what
  `resolve` returns. What is missing is a way to write body after the picture; a `per`
  rich-text slot (`::texto`) is one, and the same position rule — the occurrence written last —
  places it. Nothing about how `per` slots are attached today would have to change.

## Consequences

- `tyto-template-questao-estrategica` can drop `imagem-1` … `imagem-4` and `{imagem: N}`, in
  that repository; a carousel has as many pictures as slides.
- The skeleton writes a required `per` slot under every slide it writes; the editor marks the
  slot `per lamina` when it completes `::` and offers no frontmatter value for it; the
  manual's gallery says the same.
- A brief written for an older Tyto is unchanged: no manifest before this declared `per`.
- Not measured: a brief with hundreds of slides. Attaching a `per` slot is a lookup of the last
  occurrence, so it adds nothing per slide beyond the image read that was already there.

## Amendment — 2026-10-31 · TYTO-498: several pictures among a slide's lines

The maintainer chose, for `tyto-template-questao-estrategica`, the extension described above: a
slide may hold any number of pictures, each where it is written among the slide's lines.

```yaml
slots:
  lamina: { type: rich-text, repeat: true, min: 1 }
  imagem: { type: image, per: lamina, multiple: true }
```

```
::lamina
  Paragraph 1
::imagem ./a.png
  Paragraph 2
::imagem ./b.png
```

1. **`multiple: true` is declared on a `per` image slot, and nowhere else** (a manifest error at
   `slots.<name>.multiple`). Each `::imagem` after the same `::lamina` adds one instead of
   being `E_BAD_SLOT_VALUE`. A `per` slot without it keeps rule 2.
2. **No grammar change, and no `::texto` slot.** The parser already reads the indented lines
   under `::imagem ./a.png` as that directive's body, joined by a `Break` with none before the
   first line. For a `multiple` slot, `resolve` takes the first line as the path — on the
   directive's line or, when that is empty, on the first indented one — and the lines after
   it as the slide's body continuing. The path is reported at its own line, so a missing
   second picture is `E_ASSET_NOT_FOUND` there; the text under a refused picture still
   belongs to the slide.
3. **The order reaches the template inside `slots`, with no protocol change.** The repeatable
   slot's value gains `blocks`: the slide's body in order, `{ kind: 'text', text, range }` and
   `{ kind: 'slot', slot }` interleaved. `slots.lamina.value` stays the opening text and
   `slots.imagem` the first picture, so a template that reads one picture reads what it read
   before. `blocks` is present only when the manifest declares a `multiple` slot; `slots`
   crosses to a plugin's process as a loose record (rule 7).
4. **A brief written for the original rules is unchanged.** Without `multiple`, the lines under
   an `::imagem` are part of its path as they were, and a brief with one picture after the
   body compiles to the same scene with or without `multiple` (measured in
   `images-among-lines.test.ts`).

Not built: a `multiple` rich-text or enum slot, and reading `blocks` from an HTML template
(`template.html`); both wait for a template that needs them.
