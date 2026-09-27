# Conventions for a template written in TypeScript

This document is read by designers **and by AI agents**. Be literal.

`docs/template-authoring.md` says what the two routes are and what the SDK gives you. This
says how to organise the code route so that the second template costs less than the first.

It exists because the SDK is finished and says nothing about arrangement. `@tyto/core/template`
hands over six node builders and the values that feed them; every coordinate above that is
yours, and without a convention each template invents its own and shares nothing.

## The folder

```
_estrategia-saude/  a brand: no manifest, so the registry skips it (ADR 0039)
  tokens.ts         colours, type scale, spacing, marks — the brand's spec sheet
  presets.ts        the kit's components in this brand's look
  parts.ts          pieces only this brand draws (its header, its footer)
agenda-semana/
  manifest.yaml     slots, adjustments, formats — the contract, read without running code
  template.ts       the build function: composition only
  template.test.ts
  assets/           images the template draws
  examples/*.brief  what the template is checked against
```

Same folder as the markup route, with `template.ts` where `template.html` would be. A
folder holds one or the other, never both. A template folder holds a `tokens.ts` or a
`parts.ts` of its own only for what no other template of its brand draws.

**A template that ships _with the application_ keeps that folder and adds one import.** Nothing
resolves a path at runtime — running code that arrived in a folder is the plugin host's job
(ADR 0007) — so the pack's `src/index.ts` imports the `build` and puts it in
`BUILT_IN_TEMPLATE_BUILDS`, which is what makes it bundled. The manifest still comes off the
disk, and the two meet in `bundledTemplateSource`. The consequence to remember is dull and
bites once: the package's `tsconfig.json` has to _include_ the template folder, or the code is
built by the bundler and typechecked by nobody.

## The manifest stays YAML, and the module never imports it

**This is a constraint, not a taste.** The registry's whole job is answering "what templates
are there and what does each declare" _without importing a line of template code_
(`packages/core/src/template/registry.ts`). A picker lists templates that nobody asked to
run; a brief is validated long before output. A manifest written in TypeScript would make
opening that picker execute every template on the machine.

So the YAML is the only manifest, and it reaches the code from the outside:

```ts
// template.ts — what it exports
import type { TemplateBuild } from '@tyto/core/template';

export const build: TemplateBuild = (context) => frame({ ... });
```

Whoever loads the template pairs the two — `defineTemplate(registry.get(name), build)` —
so the declaration has exactly one home and no bundler has to learn to read YAML. That
matters more than it looks: a build step inside a template folder would change what ADR
0020 decided a template pack is, which is a folder you drop in.

`defineTemplate` is still the pairing function, and it is what a **test** calls to put a
manifest and a build together by hand.

## The four layers

Keep them apart. The boundary is what makes work travel. ADR 0039 is the decision; the
three-layer version this replaces kept tokens and parts inside the template, and nothing in
them could be reused without copying.

### 1. Configurable components and arrangement — `@tyto/template-kit`

The layer that is the same whatever brand draws it: `stack`, `row`, `inset`, `at` for
arrangement, and `bandedPage` for the page every Saúde slide is (a header band, a footer on
the bottom edge, the middle centred between them); `pillTable` for a table read out of one
slot; `titleBlock` for a centred column of optional pieces — a picture, lines of words, a
rule; `mark` and `textBlock` for a path icon and a brief's words at a stated size.

```ts
const sessions = pillTable(sessionTable, { text: slide, width, measure: context.measure });
const title = titleBlock(resultTitle, { width, fields: { titulo, chamada, emblema } });
```

A title block's `field` is the slot's name, in the brief's Portuguese; its `name` is the
node's, in English. The two are separate on purpose: the brief's vocabulary and the scene's
can change independently.

**A component holds no brand.** Every colour, face and size arrives in its configuration. A
component that needed to know whose template it is drawing is a part, and belongs to layer 3.

**A `Block` states its own width and height, and that is the point.** Nothing downstream can
work one out: a `group` in the IR has no box at all, and a text node's `box` leaves both
dimensions optional because an absent one means "as large as the content needs" — a size
only `layoutText` learns, and it runs _after_ the template has already returned. So a stack
cannot read the height it needs to place the next child; somebody has to state it, or measure
it first through `context.measure` (ADR 0038).

Placement **adds** to the coordinate a node already carries rather than replacing it, so a
node nudged by hand keeps its nudge wherever it is put.

### 2. Brand tokens — values, no logic

Colours, type scale, spacing, and flat geometry, in `_<brand>/tokens.ts`. Exported constants.

```ts
export const INK = '#009fe3';
export const TABLE = {
  badge: { w: 220, h: 86 },
  padding: { vertical: 12, left: 32, right: 32 },
} as const;
export const OWL: Mark = {
  box: { w: 186.09, h: 376.79 },
  d: 'M137.7,144.78c…',
  fillRule: 'nonzero',
};
```

**Every number is here.** `parts.ts` and `template.ts` may halve, double and centre; ESLint
refuses any other literal in them (`templates/numbers-are-tokens`). **A `d` string is a
token** — see "Geometry in, colour out" below.

### 3. Brand presets and parts

A **preset** is a component in the brand's look — a constant, not a function:

```ts
export const sessionTable: PillTableStyle = { layering: 'overlap', columns: [badge(…), { kind: 'lines', … }], … };
```

A **part** is a function returning a `Block` for something only this brand draws: the Saúde
owl header, the signed footer, the cover block. Both live in `_<brand>/` and are shared
between the brand's templates by import.

This is the component the markup route could not deliver. ADR 0022 refused a component
library across templates because a component's classes land in one flat namespace and sharing
would force CSS scoping. **In TypeScript there is no stylesheet and no class namespace**, so
that objection does not apply: a part is a function, and sharing it is an import. The
decision ADR 0022 took stands for markup and is untouched.

### 4. The template — composition only

`template.ts` says what goes where, in what order, and nothing else. It opens with a map of the
artwork, top to bottom, naming the piece that draws each band, so a reviewer reads the map and
the `frame({ children })` line and knows the slide.

## Names

- **Slots are Portuguese** — they are the brief's vocabulary (`titulo`, `slide`).
- **Everything else is English**: identifiers, and the `name` of every drawn node.
- **A node's name says what drew it**, in kebab-case: `sessionPill` would draw `session-pill`,
  the owl header draws `owl`. Names reach the SVG and HTML output as ids, so an element in a
  render maps back to one function or one preset.

## Geometry in, colour out

An icon that is one shape in one colour enters as `vector` with `kind: 'path'`, with the
`d` held as a token and the `fill` decided by the template. An illustration — many shapes,
many colours — enters as an `image`.

The test is mechanical: **if the source file has a `<style>` block, its markup does not
travel.** Exported SVGs name their classes `.cls-1`, `.cls-2` …, always from 1, so two of
them in one artwork repaint each other. TYTO-168 tracks the fact that nothing stops this
today.

Lifting only the geometry has a second payoff: the same owl is white on a dark frame and
blue on a light one without a second file.

**A path vector's `size` is its viewport, not the size it is drawn at.** `export-html` emits
`<svg width="size.w" height="size.h" viewBox="0 0 size.w size.h">` around the `d`, so anything
outside that box is clipped, and `export-svg` writes the `d` straight into the node's own
transform. So `size` is the box the `d` was **drawn in**, and a mark appears at a chosen size
through `transform: { scaleX, scaleY }`, which composes as translate-then-scale about an anchor
of `(0, 0)` and therefore leaves the coordinate a caller placed it at alone.

Getting this backwards — passing the drawn size — clips the geometry to a fraction of itself,
in both exporters, with **no diagnostic anywhere**. It is caught by looking at a render, so
look at one.

## What a template may not do

- **No Node, no DOM.** A template runs wherever the compiler runs (ADR 0010). It cannot
  read a file; assets reach it as an `AssetRef` from the brief.
- **No state between calls.** `build` runs once per (artwork, format) and a template that
  remembered would render differently depending on what ran before it.
- **No hardcoded frame size.** It is `context.size`, from `formats.yaml`.
- **No inventing `idPrefix`.** Pass `context.idPrefix` to `frame()` or the scene fails with
  `E_SCENE_DUPLICATE_ID`.
- **No throwing for an expected problem.** `TemplateError` carries a diagnostic; anything
  else becomes `E_TEMPLATE_CRASH` (ADR 0014).

## The limit that is left

A box can grow with the text inside it since ADR 0038: `context.measure` answers how tall a
text node will be, and `grownTextBlock` in the kit (what `pillTable`'s cells use) builds on it.
**Where nothing can measure** — no faces in that compile — `measure` answers `undefined`, the
box falls back to the height somebody chose, and a long line shrinks into it. So the chosen
heights still matter: they are the floor, and the whole answer when nothing measures.

**`max` is not always the guard it looks like.** On a non-repeatable `rich-text` slot it caps
characters, and that does keep a brief inside a box somebody sized. On a **repeatable** slot it
counts occurrences instead (`packages/core/src/template/manifest.ts`), so a manifest can cap how
many slides a carousel has and cannot cap how long one line inside a slide is. A template whose
varying text arrives through the repeatable slot therefore has no manifest-level guard at all.

What it has instead is a choice about `box.h`, and the choice matters:

| `box`        | a title too long for its box                                                 |
| ------------ | ---------------------------------------------------------------------------- |
| `{ w }` only | wraps out of the shape around it, silently — "as large as the content needs" |
| `{ w, h }`   | `W_TEXT_OVERFLOW`, naming the directive the author wrote and the format      |

**State the height.** The wall is the same either way; only one of the two says so.

## How the next template reuses the others

Look in the kit first, then in the brand's folder. A template that wants a table uses
`pillTable` with the brand's preset, or adds a preset beside it; a template that wants a
different look from the same preset spreads it and overrides the field
(`{ ...sessionTable, rowGap: 8 }`).

**A component is extracted when the maintainer names the templates that will use it**, which
is what ADR 0039 put in place of "on the second consumer". A part nobody has named a second
use for stays in its template. What stops the kit from becoming a second language is the same
discipline in the other direction: a component takes what its named consumers need, and an
option no consumer uses is not added.

## What the first template taught

`agenda-semana` (TYTO-167) is the first production template written this way — deliberately a
hard case: 27 drawable nodes in a slide against an 8-tag high-water mark in the markup pack, and
20 of the 27 are four copies of one five-node row. What follows is what it cost, so the second
template does not pay it again.

**The three layers held, and the payoff was bigger than stacking.** `template.ts` is composition
and nothing else; every number is in `tokens.ts` and every shape in `parts.ts`. The unexpected
win is that a `Block` carrying its own height lets a template _place itself_: the body is
centred in the room between the header and the footer, computed from the stack's measured
height, so a slide with one session and a slide with four are both balanced. The markup route
cannot do that at all — a group there has no size to read back.

**Repetition inside one slide costs the brief a separator.** A manifest may declare one
repeatable slot and its occurrences become artworks, so a carousel that repeats _slides_ has
nothing left to repeat _rows_ with. The template reads them out of the occurrence's own lines
instead. It works, it needs no card, and it asks the brief's author to learn a convention the
language does not enforce. TYTO-163 is the version where nobody learns one.

**A heading is the line that is not a row — so one separator carries two levels.** TYTO-173 moved
the agenda's repeat from the discipline up to the slide, because the published carousel puts
several disciplines on one slide. Inside one `::slide`, a line with no `|` starts a group and every
`a | b | c` line under it is one of that group's rows:

```
::slide
  FARMÁCIA
  16/09 - 14:00 | Farmacologia Geral | Profª. Rafaela Gomes
  SERVIÇO SOCIAL
  15/09 - 19:00 | Serviço Social no âmbito hospitalar | Profª. Nilza Ciciliati
```

The rule the brief's author learns is still one character. Rows written before any heading belong
to a group with no heading and are drawn, not dropped: a brief being written has that slide even
if the published carousel never does. Reach for this before a second separator.

**Split a rich-text line at top level only.** A separator inside `**bold**` or a mark is the
author doing something else, and cutting there silently reflows their words into a different
column. Nested inlines are atomic and join whichever field is open.

**A field the brief left empty must produce no node, not an empty one.** `text()` takes
`NonEmpty<TextRun>` because an empty text node is `E_SCENE_EMPTY_TEXT`. Give the part a helper
that turns "no runs" into "no node" while keeping the block's stated size, so a missing
professor leaves the row exactly as tall as its neighbours.

**What changed before the second template.** TYTO-185 moved the agenda onto the four layers
(ADR 0039): the rows became `pillTable` with the Saúde `sessionTable` preset, the tokens and
parts moved to `_estrategia-saude/`, and the rendered pixels did not change. The "every number
is in `tokens.ts`" above was not true at the time — about fifteen sizes were literals inside
`parts.ts` — which is why the rule is now a lint rather than a sentence. The wrong-`size` clip
above still deserves a diagnostic rather than a paragraph. (`tyto template check`
on a code template, the other one named here, was fixed by TYTO-170: it checks the manifest and
says the body was not checked — `docs/template-authoring.md`.)
