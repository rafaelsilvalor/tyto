# Writing templates

This document is read by designers **and by AI agents**. Be literal.

A template is a folder under `templates/<name>/`:

```
promo-curso/
  manifest.yaml     slots, adjustments, formats — validated before anything runs
  template.html     layout in Tyto markup (recommended) …
  template.ts       … or in TypeScript (heavy logic). One of the two.
  assets/           fonts, fixed images
  preview.png
```

## formats.yaml

The sizes a project renders at, one file for the whole project:

```yaml
feed: { w: 1080, h: 1080 }
story: { w: 1080, h: 1920, label: Story }
banner-wide: { w: 1600, h: 400 }
```

An id is what a manifest's `formats` list names, what reaches a shell as `--format <id>`,
and what becomes `Frame.format`; `label` is only what a picker shows a human. Blanks,
whitespace and separators in an id are refused for the same reason a template name refuses
them, and nothing about style is.

**This is the only place a number like 1080×1920 is written.** A template states its
layout, not its canvas: `compile` reads the size from here and hands it to the template as
`context.size`, so two templates cannot disagree about what `story` is. It is also what
makes `%` ("of parent") and `vw/vh` ("of frame") mean anything.

`parseFormats(source, path)` and `loadFormats(fileSystem, path)` in
`packages/core/src/config/formats.ts` read it — one file, never anything executed. A
template rendering a format the project does not define is `E_FORMAT_NOT_DEFINED`, raised
once before any frame is built rather than once per slide.

## manifest.yaml

```yaml
name: promo-curso
version: 1.0.0
description: Course promotion with teacher photo
formats: [feed, story, banner-wide] # ids defined in the project's formats.yaml
slots:
  titulo: { type: rich-text, required: true, max: 60 }
  subtitulo: { type: rich-text }
  imagem: { type: image }
  cor: { type: enum, values: [azul-escuro, laranja, verde], default: azul-escuro }
  slide: { type: rich-text, repeat: true, min: 1, max: 10 }
adjustments:
  destaque: { type: flag, applies: [slide] }
  cor: { type: enum, values: [azul-escuro, laranja, verde], applies: [slide] }
```

Slot names are chosen by the template author and may be in Portuguese — they are the vocabulary the brief writer sees. Keys of the manifest itself are English.

`templateManifestSchema` in `packages/core/src/template/manifest.ts` is the schema, and
`parseManifest(source, path)` is the only way in. It reports every problem in one pass,
each carrying the YAML path of the offending key and the range of the value under it.
These are the rules it enforces beyond the shape:

- **`min` and `max` count occurrences on a repeatable slot and characters on every other
  one** — `titulo` above is capped at 60 characters, `slide` at 10 slides. Two meanings for
  two keys is a footgun, and it is the one the example above already writes; renaming them
  is a change to this document, not to the schema alone.
- **At most one slot may repeat.** Each occurrence becomes an `Artwork`, so a second
  repeatable slot would leave the number of artworks undefined.
- **A slot or adjustment name has to be a name a brief can write** — the grammar's
  identifier, `[a-zA-Z_][a-zA-Z0-9_-]*`. A slot spelled any other way could never be set by
  any brief.
- **An `enum` lists its `values`, and nothing else may.** A `default` has to be one of them.
- **Every `applies` entry names a declared slot**, and unknown keys anywhere are an error —
  a misspelled key must reach its author rather than be silently ignored.
- **`name` may not be blank or contain a space or a slash.** It reaches a shell as
  `--template <name>` and may be joined into a path. Nothing about style is enforced.

## Discovery: `TemplateRegistry`

`loadTemplateRegistry(fileSystem, root)` walks `root` and reads one `manifest.yaml` per
subfolder, through a `FileSystem` port — `core` is pure and may not import `node:fs`
(ADR 0010). It exposes `list()`, `get(name)`, `formatsOf(name)` and `directoryOf(name)`.

**It never imports or executes `template.ts` or `template.html`.** Listing templates in a
picker and validating a brief both happen long before anyone asks for output, and neither
moment should be able to run a third party's code. Running a template is `compile`'s job.

A folder with no manifest is not a template and is skipped in silence; a folder _with_ a
manifest that does not parse is a `failure` on the registry, and the templates around it
still work. Two folders declaring the same `name` is a failure on the second one, so which
template a name means does not depend on the order the filesystem listed them in. The load
itself fails only when `root` cannot be read at all.

## template.html — Tyto markup

Looks like HTML+CSS, but every tag is an IR node and the CSS is a controlled subset. No JS.

<!-- The block below is the Tyto template language, not CSS: Prettier would
     reflow it as a stylesheet and rewrite its quotes. -->

<!-- prettier-ignore -->
```html
<frame format="feed" bg="none">
  <image src="{imagem}" fit="cover" class="bg" />
  <group class="content" opacity="0.95" blend="normal" mask="#grad">
    <rect id="grad" class="grad" />
    <text slot="titulo" class="title" />
    <text slot="subtitulo" class="sub" />
  </group>
  <vector src="assets/logo.svg" class="logo" />
</frame>

<frame format="story" extends="feed">
  <!-- inherits the feed tree; only @format CSS changes -->
</frame>

<style>
  :root { --color: var(--slot-cor); }
  .bg    { x: 0; y: 0; w: 100%; h: 100%; }
  .title { x: 64; y: 720; w: 952; font: 700 72px/1.05 "Inter"; color: white; }
  .sub   { x: 64; y: 880; w: 952; font: 400 36px/1.2 "Inter"; color: white; }
  .logo  { x: 64; y: 64; w: 200; }
  @format story { .title { y: 1400; font-size: 96px; } .sub { y: 1600; } }
  @if slot(imagem) is empty { .title { y: 400; } }
  @each slide { .title { content: slot(slide); } }
</style>
```

**Tags**: `frame`, `group`, `rect`, `text`, `image`, `vector`. **Attributes**: `id`, `class`, `slot`, `src`, `fit`, `opacity`, `blend`, `mask`, `clip`, `extends` (frame). **Accepted CSS properties**: `x y w h rotation anchor`, `font font-size font-weight line-height letter-spacing color text-align vertical-align overflow`, `fill stroke radius`, `opacity mix-blend-mode`, `shadow blur`, `visible`. Units: `px`, `%` (of parent), `vw/vh` (of frame). Any other property ⇒ `E_UNSUPPORTED_CSS` with a suggestion.

**Slot rules**: `slot="x"` on `text` injects the rich text; on `image` injects the asset. Adjustments become classes: `{destaque}` ⇒ `.destaque` targetable from CSS; `{cor: laranja}` ⇒ `--slot-cor: laranja`.

## template.ts — code path

```ts
import { defineTemplate, frame, group, text, image } from '@tyto/core/template';
export default defineTemplate(manifest, ({ slots, format, adjustments }) => frame({...}));
```

Same nodes, same output. Use it when you need computation (text auto-fit, dynamic grids).

`defineTemplate(manifest, build)` pairs a manifest with the function `compile` calls **once
per (artwork, format)**. It does nothing else — no registration, no lifecycle, no state. A
template that needs to know where it is in a scene reads its context rather than
remembering.

```ts
build: (context: TemplateContext) => Frame;
```

| `context`     | What it is                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `format`      | the format this call is for, one of the manifest's                                                                                       |
| `idPrefix`    | **pass it to `frame({ idPrefix })`** — see below                                                                                         |
| `artwork`     | `{ id, index, count }`, so a slide can number itself `2/3`                                                                               |
| `slots`       | every slot the brief gave a value, with the repeatable one already resolved to _this_ artwork's occurrence — `slots.slide` is this slide |
| `adjustments` | this artwork's, flattened: `true` for a flag, the value for an enum                                                                      |

**Pass `idPrefix` or the scene will not validate.** Node ids are derived from position, so
two artworks with a `feed` frame each would both generate `feed.0`, and so would the two
formats of one artwork. The prefix carries both — `slide-1.feed` — and a template that
ignores it produces duplicate ids that `parseScene` reports as `E_SCENE_DUPLICATE_ID`.

### `runsOf` — rich text into runs

The brief says what is emphasised; the template says what emphasis looks like.

```ts
runsOf(text, { font, size, color }, { bold: 700, mark: (key, value) => ({ color: '#ff5900' }) });
```

Bold becomes a weight, italic becomes a style, and a `Break` becomes a `LineBreak` run
rather than a `
` in a string (ADR 0016). Marks are the part no default can cover:
`{cor:laranja}` names a colour in the template's own vocabulary, so the template supplies
the mapping, and a mark nothing maps passes its children through unchanged.

### What `compile` does with the result

It calls the function once per (artwork, format), collects the fonts and assets **the scene
reached for** — an asset `resolve` found and the template chose not to draw is in neither
list — and hands the whole thing to `parseScene`. A template is code, and code that
produces IR is exactly the code whose output is validated rather than trusted.

Nothing a template throws escapes (ADR 0014): a `TemplateError` carries the diagnostic it
built, and anything else becomes `E_TEMPLATE_CRASH`. Returning a frame for a format it was
not asked for is caught too — that is a template that mixed up its own branches, and the
scene would otherwise render the story layout under the feed's name.

**Frame size comes from `context.size`**, which `compile` reads from `formats.yaml`. A
template that hardcodes one is writing down a number the project already knows.

### The SDK

```ts
import { frame, group, rect, text, image, vector } from '@tyto/core/template';
import {
  color,
  solid,
  linearGradient,
  radialGradient,
  imagePaint,
  stop,
  font,
  run,
} from '@tyto/core/template';
```

`frame({ format, size, background?, children?, idPrefix? })` returns IR. The six node
builders return **drafts** — every field filled except the id — and `frame()` turns them
into nodes. Write only what differs from the default: transform, opacity, blend mode,
visibility, clip and effects are supplied, and `transform: { y: 660 }` keeps the rest of
the identity.

```ts
frame({
  format: context.format,
  size: context.size,
  background: solid('#0c0e14'),
  children: [
    image({ asset: imagem, size: { w: 1080, h: 620 } }),
    group({
      id: 'copy',
      transform: { y: 660 },
      children: [
        text({
          box: { w: 920 },
          lineHeight: 1.1,
          overflow: 'shrink',
          runs: [run('Turma nova', { font: font('Inter'), size: 96, weight: 700, color: '#fff' })],
        }),
      ],
    }),
  ],
});
```

- **Ids are optional and derived from position.** The example produces `feed.0`, `copy`
  and `copy.0`: the path segment is the node's own id when it has one, so reordering a
  sibling above a named group does not rewrite its children. A generated id is stable
  across runs — it is derived, not counted — which is what determinism requires.
- **Ids must be unique across the whole scene, and a frame only sees its own subtree.**
  Two artworks with a `feed` frame each would both generate `feed.0`. Pass `idPrefix` (the
  compile stage passes the artwork id) or `parseScene` reports `E_SCENE_DUPLICATE_ID`.
- **Colour is written as CSS and stored as channels.** `color()` reads `#rgb`, `#rgba`,
  `#rrggbb` and `#rrggbbaa`; `solid`, `stop` and `run` take a hex string directly. There
  are no named colours in the SDK — `white` is the stylesheet's word, not a value's.
- **Misuse is a type error where a type can hold it.** A `text` without runs and a
  gradient with fewer than two stops do not compile. What a type cannot check is a hex
  string's contents: `color('#gggggg')` throws a `TemplateError` carrying a ready
  `E_TEMPLATE_VALUE` diagnostic, because a bad colour literal is a bug in code and not
  something a brief author can cause. `color()` is the only builder that throws, and the
  exception stops at `compile`, which catches everything a template throws and turns it
  into diagnostics — a `TemplateError` into the one it carries, anything else into
  `E_TEMPLATE_CRASH`. A broken template produces diagnostics, never a crash (ADR 0014).
- **Builders do not validate.** Zod is the validator and `parseScene` is where it runs.

## Agent workflow

1. Read `manifest.yaml` and this document.
2. Write `template.html`.
3. Run `tyto template check templates/<name>` — returns diagnostics with line numbers.
4. Run `tyto render examples/<name>.brief --template <name> --out /tmp/x` and inspect the PNG.
5. Iterate until `check` is clean and there is no `W_TEXT_OVERFLOW`.
