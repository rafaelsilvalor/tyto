# 0158 — An image ref carries its pixel size

Status: accepted · 2026-10-30 · TYTO-481 · extends ADR 0062 (a code template reads its own
folder) and ADR 0153 (declared values); a protocol change under ADR 0149 point 4

## Context

On 2026-10-30 the `tyto-template-questao-estrategica` template (TYTO-477) had to frame a
statement image whose height follows the picture. It could not: an `AssetRef` reaching a
template is `{ id, source, path?, hash }`, and a template opens no file (ADR 0010), so it has
no way to learn how tall a picture is. The template asked the person to write
`{proporcao: …}` on the slide by hand.

**What existed at `origin/main` b40dea8, read in the code.** `@tyto/io` already measured
every picture — `imageSize(bytes)` reads the header of each format Tyto embeds — but only for
the exporters, after `compile`: `fileResources` and `fileTemplateAssets` answer
`SvgResources.assetSize` so `export-svg` can crop a `cover` image itself (TYTO-60). The three
places that build a ref a template receives already held the bytes, to hash them:
`fileAssetResolver` (a brief's images, for slots and supplied values), the plugin source cache
(`asset-source`, ADR 0117) and `fileTemplateAssets.image` (the template's own folder, and an
image value's default).

## Decision

**`AssetRef` gains an optional `size: { w, h }`**, the picture's own pixel size, which the
host reads off the header where it builds the ref.

- **Measured where the bytes already are.** Each of the three producers spreads
  `sizeFieldOf(bytes)` into the ref it returns. No second read and no decode: the header is
  in the buffer that was hashed.
- **Absent, never guessed.** A header nothing parses, a hand-built ref and a ref from an older
  host have no `size`. The field is left out rather than written as `undefined`, because a
  strict schema across the isolation boundary reads an `undefined` key as a value.
- **`imageHeight(asset, width, fallback)` in `@tyto/template-kit`** answers how tall a frame
  `width` wide must be to hold the picture, and `fallback` — a height the template chooses —
  when there is no size. A template sizes the frame; the image node's `fit` still decides how
  the picture fills it.
- **It crosses the isolation boundary, at protocol 13.** The guest checks a declared value and
  a shipped image with the strict `assetRefSchema`, so a guest on 12 would refuse a ref that
  carries `size`. By ADR 0149 point 4 that is a minor of `@tyto/plugin-api`; a slot's picture
  (whose record the guest checks loosely) carries the field the same way.
- **The exporters are unchanged.** They still ask `assetSize` of their resources, which reads
  the same bytes. Moving them to `ref.size` is possible and is not this decision.

## Consequences

- A template can drop a hand-written proportion: `tyto-template-questao-estrategica`'s
  `{proporcao}` is its first user, in that repository.
- `Scene.assets` entries and image nodes carry `size` when the host measured the picture, so a
  scene snapshot built from real files names it. The hash is still the bytes' (ADR 0003): the
  same bytes give the same size.
- A plugin built against protocol 12 is refused at `hello` by a host on 13, and the next
  release of the contract carries the change as a minor.
- Not measured: an animated GIF or WebP answers its canvas, not a frame's; an SVG answers the
  box it declares, which is what a renderer sizes it by.
