# Conventions for a template written in TypeScript

This document is read by designers **and by AI agents**. Be literal.

`docs/template-authoring.md` says what the two routes are and what the SDK gives you. This
says how to organise the code route so that the second template costs less than the first.

It exists because the SDK is finished and says nothing about arrangement. `@tyto/core/template`
hands over six node builders and the values that feed them; every coordinate above that is
yours, and without a convention each template invents its own and shares nothing.

## The folder

```
_azul/             a brand: no manifest, so the registry skips it (ADR 0047)
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

The tree is the one `agenda-semana` and `_azul/` had in the built-in pack. Since TYTO-436 both
live in the template's own repository, `tyto-template-agenda-semana`, with the brand module
trimmed into its `src/azul/`; the arrangement inside them is the same.

Same folder as the markup route, with `template.ts` where `template.html` would be. A
folder holds one or the other, never both. A template folder holds a `tokens.ts` or a
`parts.ts` of its own only for what no other template of its brand draws.

**What several of the house's brands share is a package, not a folder** (ADR 0055, ADR 0151):
`@tyto/house-style` holds the logo and signature placeholders (`marks.ts`), the brand kit's
marks or the placeholders (`kit.ts`), what sets each brand apart (`brands.ts`), when a slide
carries the brief's `selo` (`seal.ts`) and one piece's composition for every brand that
publishes it (`compose.ts`, `table.ts`, `banner.ts`). A template imports it by name, so the
same import works from a template in its own repository. The table's tokens are the subpath
`@tyto/house-style/table-tokens`, because they reuse three names of the root's `tokens.ts`.
The azul brand's tokens, presets, logo header and signed footer, which
`tyto-template-agenda-semana` and `tyto-template-aprovados` share, are the subpath
`@tyto/house-style/azul` for the same reason (TYTO-476).

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

Keep them apart. The boundary is what makes work travel. ADR 0047 is the decision; the
three-layer version this replaces kept tokens and parts inside the template, and nothing in
them could be reused without copying.

### 1. Configurable components and arrangement — `@tyto/template-kit`

The layer that is the same whatever brand draws it: `stack`, `row`, `inset`, `at` for
arrangement, and `bandedPage` for the page every azul slide is (a header band, a footer on
the bottom edge, the middle centred between them); `pillTable` for a table read out of one
slot; `titleBlock` for a centred column of optional pieces — a picture, lines of words, a
rule; `mark` and `textBlock` for a path icon and a brief's words at a stated size.

```ts
const sessions = pillTable(sessionTable, { text: lamina, width, measure: context.measure });
const title = titleBlock(resultTitle, { width, fields: { titulo, chamada, imagem } });
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
export const ARROW: Mark = {
  box: { w: 2360.92, h: 377.81 },
  d: 'M2130,377.81v-134.18H0…',
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

A **part** is a function returning a `Block` for something only this brand draws: the azul
logo header, the signed footer, the cover block. Both live in `_<brand>/` and are shared
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

### One piece, several brands

When brands publish the same piece and differ only in colour or sign-off — the weekly mock-exam
agenda for roxo, ocre and vinho (TYTO-200) — each brand still gets **its own
template**, so its manifest says its `brand` and its `formats`. The composition is written once,
in the house's `compose.ts`, as a function of a `Brand`; each `template.ts` is that function
applied to its brand, one line. What varies by brand is an argument, never a copy (ADR 0055).

### The seal

A carousel may close with a seal: the brief's optional `selo`, an art the frame's width and
140 tall, glued to the foot of the **last grid slide** and never drawn on a story (TYTO-201).
**The page shrinks by the seal's height**: `sealed` in the kit hands the layout the shorter
size and returns the seal to draw, so a middle centred on the page centres above the seal and
a footer standing on the bottom edge stands on the seal. When a slide carries it is the
house's rule, in `house-style/src/seal.ts`; a template only passes `sealOf(context)` to `sealed`
and spreads the seal into its frame's children.

**Every house template with a grid offers it the same way** (TYTO-480), so a brief writes the
seal without knowing which template it is in:

- **The slot.** `selo: { type: image }` in the manifest, optional, with this comment: the art,
  1080 × 140, glued to the foot of the last slide (TYTO-201). The brief writes it in its
  frontmatter, `selo: ./selo.png`, relative to the brief; a configuration's `brief.slots` may
  set it for every brief (`docs/plugin-authoring.md`). The art is drawn with `cover`, so an art
  a few pixels off 1080 × 140 still fills the band.
- **The drawing.** `const page = sealed(context.size, sealOf(context))` before anything is
  placed; the layout works on `page.size`, and `...page.seal` is the frame's last child, so it
  paints over the paper and nothing else.
- **The signature clears it** (TYTO-469). Whatever stands on the foot — the signature, the
  arrow to the next slide, a page number — rises by the band, `context.size.h - page.size.h`,
  and keeps its distance to the page's foot; `reportOverflow` measures against `page.size.h`.
  Nothing is drawn under the seal. `house-style/src/compose.test.ts` pins it on the
  composition the house owns whole: the sign-off ends above the seal's top, the middle centres
  above it, and an overflow is measured to it.
- **A brief without it draws the same bytes.** `sealed` with no seal returns the frame's size
  and nothing to draw, so adding the slot changes no example's render; each repository's PR
  shows it with a hash table of its example PNGs and unchanged HTML snapshots, and a test
  compiles a sealed brief and checks the seal and the signature's foot.
- **When the composition is the house's** (the one-image table's `oneImageTable`), the
  template lays it out on the shorter page and frames it again: build with
  `{ ...context, size: page.size }`, then `frame()` at `context.size` with the build's
  background and children and `...page.seal`. The children keep their ids, and the seal takes
  the next one.
- **Where it is not offered.** `sealOf` answers only for a format named `grid`, so a template
  that renders no grid — the product banner's three sizes — does not declare `selo`: the slot
  would be accepted and never drawn. A template with a grid and a story declares it, and the
  story ignores it, as the maintainer never asked for a sealed story. On 2026-11-07 the
  repositories of `agenda-semana`, `aprovados`, `simulados-semana`, `concursos-abertos`,
  `concursos-abertos-ec`, `news-da-semana`, `questao-estrategica` (both its templates),
  `tabela` and `voce-conhece` (since its v0.6.0) offer it; `banner` does not, having no grid.

## Names

- **Slots are Portuguese** — they are the brief's vocabulary (`titulo`, `slide`).
- **Everything else is English**: identifiers, and the `name` of every drawn node.
- **A node's name says what drew it**, in kebab-case: `sessionPill` would draw `session-pill`,
  the logo header draws `logo`. Names reach the SVG and HTML output as ids, so an element in a
  render maps back to one function or one preset.

## Geometry in, colour out

An icon that is one shape in one colour enters as `vector` with `kind: 'path'`, with the
`d` held as a token and the `fill` decided by the template. An illustration — many shapes,
many colours — enters as an `image`.

The test is mechanical: **if the source file has a `<style>` block, its markup does not
travel.** Exported SVGs name their classes `.cls-1`, `.cls-2` …, always from 1, so two of
them in one artwork repaint each other. TYTO-168 tracks the fact that nothing stops this
today.

Lifting only the geometry has a second payoff: the same mark is white on a dark frame and
blue on a light one without a second file.

**A brand's logo and signature are not tokens of the repository.** A brand kit supplies them
(ADR 0063) and the template reads them through `drawLogo(context.brand, height, inks)` and
`signatureOf(context.brand)` in `house-style/src/kit.ts`, which answer the placeholders when the kit
leaves a field out (ADR 0065). A kit's mark may come in two tones (ADR 0066); the template
passes the colour of each, and `oneInk(colour)` where it draws the logo in one. `tools/repo-checks` fails when a known brand token comes back
into a tracked text file.

**A path vector's `size` is its viewport, not the size it is drawn at.** `export-html` emits
`<svg width="size.w" height="size.h" viewBox="0 0 size.w size.h">` around the `d`, so anything
outside that box is clipped, and `export-svg` writes the `d` straight into the node's own
transform. So `size` is the box the `d` was **drawn in**, and a mark appears at a chosen size
through `transform: { scaleX, scaleY }`, which composes as translate-then-scale about an anchor
of `(0, 0)` and therefore leaves the coordinate a caller placed it at alone.

Getting this backwards — passing the drawn size — clips the geometry to a fraction of itself,
in both exporters, with **no diagnostic anywhere**. It is caught by looking at a render, so
look at one.

## A value that must not break is glued with a no-break space

Tyto decides every line break before an exporter sees the text, and **a break opportunity is
a plain space (U+0020) and only that** (`packages/core/src/text/layout.ts`), except the space
before a standalone math operator, which never starts a line (ADR 0169). So a template
that must keep `R$ 33.820,39` or `5 + CR` on one line writes their inner spaces as U+00A0. A
no-break space draws and measures as a space and breaks nothing, in the measurement, in
`export-html` and in `export-svg` alike. No exporter has to agree to anything.

The same move chooses _where_ a phrase breaks. `R$ 5.667,92 a R$ 13.560,00` glues the `a` to
the value before it, so the only break left falls between the two values. `house-style/src/breaks.ts`
holds the mechanism and the rules the house's templates share: a parenthesised group like
`(GO)` stays whole and joins the word before it, and `pieces` are what a line can never be
narrower than. `house-style/src/table-text.ts` (TYTO-218) adds the table's own rules on top.

## A short text in a fixed box sets its own breaks

Tyto's layout breaks greedily, so a title it wraps leaves a long line over a short one and
ends a line wherever the width runs out. A template that must do better decides the breaks
itself and draws each line after a `lineBreak()`, leaving the layout nothing to choose.
`house-style/src/balance.ts` (TYTO-210, the product banner) does it for a text of up to twelve
pieces: the largest size between a floor and a ceiling at which it fits; then, at that size,
no line ending on a short function word (`de`, `do`, `e`…) when a break that fits avoids it,
the fewest lines, and the narrowest widest line. A clean break at a smaller size beats an
awkward one at a larger size. Above twelve pieces it breaks greedily, so a pasted paragraph
costs one pass. When even the floor does not fit, it draws the floor and reports
`W_TEMPLATE_OVERFLOW`.

**Gaps are weights, and text ends on more than one word** (ADR 0167, TYTO-516). A slide that
stacks blocks between a fixed head and a fixed foot asks `spaceByWeight` from
`@tyto/template-kit` for their tops: it gives one weight per gap, the outer two included, and
every gap comes out as that weight times one unit — so the gaps grow and shrink together, the
largest stays the largest, and equal outer weights centre the stack. A text that may wrap goes
through `settle`, which keeps a paragraph from ending on a line of one word by breaking the line
above one word earlier, then with letter spacing, then a smaller size, within the template's limits, and names the word for `reportOrphan`
when it cannot. Neither knows a template: the weights and the limits are the template's.

**A sign, an amount and its scale word stay on one line** (TYTO-593). A template that sets
prices, salaries or percentages passes the brief's words through `keepTogether` before laying
them out, and a line can no longer end on `R$` with `9,8 mil` on the next. The default rules
for money are the ones the house's table already glued, and a number keeps its unit of measure (`3 s`, `25 °C`, TYTO-620); a template's own pairs go beside them as data.

**A line's label is what comes before its first `:`, in every template** (the maintainer,
2026-11-03; TYTO-594). A template that draws labelled lines reads them with `labelOf`, so
`Banca: Quintex` has a label wherever it is written, and paints the label with a declared value
a configuration can change. `**…**` is not a label marker: it is the highlight for something out
of the ordinary, and it works inside the label or the text.

## Highlights are data the template declares (TYTO-554)

`highlights(spec)` in `@tyto/template-kit` turns what a brief wrote — `**…**`, `*…*`, a mark —
into a style, from a map and never from a function per template. `highlights.with({ … })` varies
it in one place (the title's bold in navy) without repeating the rest, and `textBlock`,
`grownTextBlock` and `naturalWidth` take it as `TextStyle.highlights`.

**House-wide — every template, never opted into:**

- **`**…**` is always the highlight.** It is the house's mark for something out of the ordinary
  (the maintainer, 2026-11-03), so a brief means the same thing by it in every template. A
  template with no `highlights` still draws it, at weight 700 in the surrounding colour, which is
  what `runsOf` has always drawn. `Inscrições até **10/11**` is highlighted wherever it is
  written.
- **A colour mark takes the highlight's weight.** A family declared `like: 'bold'` lays the
  highlight's style under each name's, so `{cor:azul}Direito{/}` is as heavy as `**Direito**`,
  in blue: a coloured word reads as highlighted too.
- **The closest wrapper decides.** In `{cor:azul}a **b**{/}` the `b` takes the highlight's
  colour; in `**a {cor:azul}b{/}**` the `b` is blue. It is the rule nested bold and italic
  already had (ADR 0015).
- **The value names are shared**, so a plugin file configures any template the same way (ADR
  0153). `highlightsFromValues(context, defaults, place?, faces?)` reads:

  | Name                      | Kind     | What it sets                                        |
  | ------------------------- | -------- | --------------------------------------------------- |
  | `highlight-weight`        | `number` | The weight of `**…**`, and of a `like: 'bold'` mark |
  | `highlight-color`         | `color`  | The colour of `**…**`                               |
  | `<place>-highlight-color` | `color`  | The same in one place, over `highlight-color`       |
  | `mark-<family>-<name>`    | `color`  | The colour one mark name maps to: `mark-cor-azul`   |

  The weight is a `number`, as ADR 0153 has no weight kind: declare it with `min: 100` and
  `max: 900`, the weights a face can have, so a configuration cannot ask for one that does not
  exist. A template whose manifest lists only some weights under `faces:` passes that list as
  `faces` (the same list its faces test pins to the manifest), and the weight snaps to the
  nearest of them, a tie going to the heavier (TYTO-619): a configured `600` with faces at 500
  and 700 is drawn at 700, in a face its plugin's process can measure.

  ```yaml
  values:
    highlight-weight: { type: number, default: 700, min: 100, max: 900 }
    highlight-color: { type: color, default: '#ff5900' }
    mark-cor-azul: { type: color, default: '#1f6fd1' }
  ```

  A name the manifest does not declare leaves the template's constant, so declaring nothing draws
  what `highlights(defaults)` draws.

**The template's own — its vocabulary, not the house's:**

- **Which mark names exist and what colour each is.** Only the template knows what `azul` is in
  its palette, so `{ cor: { like: 'bold', values: { azul: { color } } } }` is in the template, and
  a name it does not list passes its text through unchanged — a template that does not use a
  mark should not have to refuse it.
- **Which places vary.** A template names its places (`title`, `statement`) by the
  `<place>-highlight-color` values it declares; the kit does not list them.
- **A mark's colour on a place that is not paper is `<place>-mark-cor-<name>`** (TYTO-623). A
  swatch chosen for white paper can vanish on a dark cover, so the template declares the colour
  each name takes there beside the place's own colour: `deep-mark-cor-azul`, `-vermelho`,
  `-verde` and `-ocre` in `questao-estrategica`, whose place is `deep`, while `mark-cor-<name>`
  stays the colour on paper. The kit reads only `<place>-highlight-color` and
  `mark-<family>-<name>`, so the template reads these itself with `colorValue`, one call per
  name with its own constant as the fallback, and lays them over that place's highlights with
  `highlights.with()`.

**Frontmatter text accepts exactly a subset.** A frontmatter string never reaches the brief
parser, so `richTextOfPlain` reads it: `**…**` and `{key:value}…{/}`, each over plain text, and
`\n` as a break. No nesting, no italic, no span across a line break; a `**` or `{` that closes
nothing stays as written. `titulo: Questão **comentada**` is highlighted; `2 ** 3` is not.

## What a template may not do

- **No Node, no DOM.** A template runs wherever the compiler runs (ADR 0010). It cannot
  read a file; assets reach it as an `AssetRef`, from the brief or, for its own folder,
  through `context.files` (ADR 0062).
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
is what ADR 0047 put in place of "on the second consumer". A part nobody has named a second
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
several disciplines on one slide. Inside one `::lamina`, a line with no `|` starts a group and every
`a | b | c` line under it is one of that group's rows:

```
::lamina
  FARMÁCIA
  16/09 - 14:00 | Farmacologia Geral | Profª. Marcela Rocha
  SERVIÇO SOCIAL
  15/09 - 19:00 | Serviço Social no âmbito hospitalar | Profª. Norma Castilhos
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
(ADR 0047): the rows became `pillTable` with the azul `sessionTable` preset, the tokens and
parts moved to `_azul/`, and the rendered pixels did not change. The "every number
is in `tokens.ts`" above was not true at the time — about fifteen sizes were literals inside
`parts.ts` — which is why the rule is now a lint rather than a sentence. The wrong-`size` clip
above still deserves a diagnostic rather than a paragraph. (`tyto template check`
on a code template, the other one named here, was fixed by TYTO-170: it checks the manifest and
says the body was not checked — `docs/template-authoring.md`.)
