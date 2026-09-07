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

`defineTemplate` is not built yet — it takes a manifest, and the manifest schema arrives
with E4.1. The builders it wraps are shipped and usable today.

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
  format: 'feed',
  size: { w: 1080, h: 1080 },
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
