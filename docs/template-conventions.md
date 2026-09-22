# Conventions for a template written in TypeScript

This document is read by designers **and by AI agents**. Be literal.

`docs/template-authoring.md` says what the two routes are and what the SDK gives you. This
says how to organise the code route so that the second template costs less than the first.

It exists because the SDK is finished and says nothing about arrangement. `@tyto/core/template`
hands over six node builders and the values that feed them; every coordinate above that is
yours, and without a convention each template invents its own and shares nothing.

## The folder

```
agenda-semana/
  manifest.yaml     slots, adjustments, formats — the contract, read without running code
  template.ts       the build function
  assets/           images the template draws
  examples/*.brief  what the template is checked against
```

Same folder as the markup route, with `template.ts` where `template.html` would be. A
folder holds one or the other, never both.

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

## The three layers

Keep them apart. The boundary is what makes work travel.

### 1. Tokens — values, no logic

Colours, type scale, spacing, and flat geometry. Exported constants.

```ts
export const INK = { r: 77, g: 77, b: 77, a: 1 } as const;
export const OWL = { viewBox: { w: 186.09, h: 376.79 }, d: 'M137.7,144.78c…' } as const;
```

**A `d` string is a token.** Flat single-colour geometry belongs in code rather than in a
file beside the template — see "Geometry in, colour out" below.

Tokens belong to a brand, not to a mechanism, so they live beside the templates that share
them and never in `@tyto/template-kit`.

### 2. Parts — functions that return a draft

```ts
export function pill(label: RichText, tone: Tone): Block { … }
```

This is the component the markup route could not deliver. ADR 0022 refused a component
library across templates because a component's classes land in one flat namespace and
sharing would force CSS scoping. **In TypeScript there is no stylesheet and no class
namespace**, so that objection does not apply here: a part is a function, and sharing it is
an import. The decision ADR 0022 took stands for markup and is untouched.

A part returns a `Block` rather than a bare draft whenever anything will be placed around
it — see the next layer for why.

### 3. Arrangement — `@tyto/template-kit`

`stack`, `row`, `inset`, `at`. The only layer that is the same whatever is being drawn, so
the only one that ships as a package.

```ts
const body = stack({
  gap: 24,
  items: [heading, ...sessions.map(sessionRow)],
});
return frame({ …, children: [at(80, 420, body)] });
```

**A `Block` states its own width and height, and that is the point.** Nothing downstream can
work one out: a `group` in the IR has no box at all, and a text node's `box` leaves both
dimensions optional because an absent one means "as large as the content needs" — a size
only `layoutText` learns, and it runs _after_ the template has already returned. So a stack
cannot read the height it needs to place the next child; somebody has to state it.

Placement **adds** to the coordinate a node already carries rather than replacing it, so a
node nudged by hand keeps its nudge wherever it is put.

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

## The limit this route does not remove

A box still cannot grow with the text inside it. A template cannot measure text — the font
cache is not in its context, and measurement happens after `build` has returned — so every
height a `Block` states is a height somebody chose. TYTO-162 is that gap; until it closes,
a long title is handled by choosing a size that fits the longest one you accept.

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

## How the second template reuses the first

Put tokens and parts in modules, not in the template file. A template file should read as
composition: what goes where, in what order. When template two wants a part, it imports it;
when it wants a different look from the same part, the part takes a parameter.

Move a part into a shared module when the **second** template needs it, not in advance.
ADR 0022 shipped a reuse mechanism ahead of its evidence and measured zero consumers five
days later; the lesson was written down there and applies here unchanged.

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
instead — first line the heading, each line after it `a | b | c`. It works, it needs no card,
and it asks the brief's author to learn a convention the language does not enforce. TYTO-163 is
the version where nobody learns one.

**Split a rich-text line at top level only.** A separator inside `**bold**` or a mark is the
author doing something else, and cutting there silently reflows their words into a different
column. Nested inlines are atomic and join whichever field is open.

**A field the brief left empty must produce no node, not an empty one.** `text()` takes
`NonEmpty<TextRun>` because an empty text node is `E_SCENE_EMPTY_TEXT`. Give the part a helper
that turns "no runs" into "no node" while keeping the block's stated size, so a missing
professor leaves the row exactly as tall as its neighbours.

**What should change before the second template.** Nothing moves into a shared module yet —
that is this document's own rule and the evidence is not in. Two things are worth fixing first:
`tyto template check` reads `manifest.yaml` and `template.html`, so it reports a read failure
for a folder whose body is a `template.ts` (TYTO-170), and the wrong-`size` clip above deserves
a diagnostic rather than a paragraph.
