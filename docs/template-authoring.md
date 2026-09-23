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
- **Both ends are errors, on both kinds of slot.** Too short, too long, too few and too many
  are all `E_BAD_SLOT_VALUE`, carrying the range of the directive that set the value — or,
  where there is no occurrence to point at, the frontmatter fallback. One pair, one
  severity: a `min` that only warned would mean the same two keys behaved three different
  ways depending on `repeat` (TYTO-67).
- **A `min` above its `max` is refused while the manifest is read**, at `slots.<name>.min`,
  naming both numbers. The pair would be satisfiable by nothing, so every brief written
  against that template would be `E_BAD_SLOT_VALUE` at one end or the other — an error
  about the brief, repeated, for a mistake in the template. `min` equal to `max` is fine:
  that is an exact length, not a contradiction.
- **Neither is accepted where it would count nothing.** Characters only exist on
  `rich-text`, so `{ type: image, max: 60 }` and `{ type: enum, min: 2 }` are errors at
  `slots.<name>.max` and `slots.<name>.min` rather than caps that silently never fire. Add
  `repeat: true` and the same pair counts occurrences, which is meaningful for every type.
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
template a name means does not depend on the order the filesystem listed them in.

### The search path: the project, then the built-in pack

`roots` is a list in precedence order and **earlier wins** (ADR 0020). The CLI passes
`--templates <dir>` first and the built-in pack second, so:

- `tyto render` finds `agenda-semana`, `promo-curso` and `carrossel-lista` with no flag at all. The pack is
  `@tyto/templates`' own `templates/` folder, located by resolving that package's
  `package.json` — which is right in a workspace, in a published install, and inside an
  Electron `asar`.
- A project's own `templates/promo-curso/` **wins**, and the built-in it hid is reported as
  `W_TEMPLATE_SHADOWED` naming both folders. A warning, because nothing is wrong: the run
  produced the template the user asked for. Not silence, because "my edit to the built-in
  did nothing" is the question this rule generates.
- `--templates` pointed at the pack's own folder still works and warns about nothing: a
  root listed twice is de-duplicated rather than left to shadow itself.
- The default `templates/` not existing is **not** reported. A project without one renders
  from the pack, and a complaint about a folder the user never mentioned would open every
  such run. A folder they _did_ name and do not have is still `E_TEMPLATE_READ`.

The two collisions stay different. Two folders in **one** root is `E_TEMPLATE_DUPLICATE`,
an error, because directory order is nobody's decision. The same name in a **later** root is
a warning, because that order is one somebody chose.

The load fails — `Err` rather than a registry with failures in it — only when every root is
unreadable, which is the one case where there is no registry to return rather than an
incomplete one.

### In the desktop app

The window has the same door, with the same precedence. **Settings → choose a template
folder** (the command bar lists it as _Escolher pasta de templates…_) points the app at a
folder of template subfolders; it is searched before the built-in pack, so a template of yours
with a built-in one's name wins, exactly as `templates/` beside a brief does for the CLI.

The choice is remembered in `settings.json` beside `layout.json` in the app's data folder, so
it survives a restart, and _Voltar aos templates internos_ clears it with no restart either.
The footer shows which folder is in force, or `internos` when none is.

**One rule the CLI does not have.** A chosen folder's own `formats.yaml` replaces the built-in
pack's when it has one, and falls back to the built-in one when it does not — so a folder that
is only templates does not have to carry a formats file to be usable. A `formats.yaml` that is
there and will not parse keeps the built-in formats and reports the error in the problems
panel, rather than leaving the app with no formats at all.

A folder that is readable and holds no `manifest.yaml` anywhere is reported in the problems
panel as having no templates, and the built-in pack keeps working.

## template.html — Tyto markup

Looks like HTML+CSS, but every tag is an IR node and the CSS is a controlled subset. No JS.
`compileTemplate(source, { manifest, assets })` in `packages/template-lang` is the only way
in; it returns the same `Template` a `template.ts` exports, so `compile` cannot tell the two
paths apart.

<!-- The block below is the Tyto template language, not CSS: Prettier would
     reflow it as a stylesheet and rewrite its quotes. -->

<!-- prettier-ignore -->
```html
<frame format="feed" bg="none">
  <image src="{imagem}" fit="cover" class="bg" />
  <rect id="grad" class="grad" />
  <group class="content" opacity="0.95" blend="normal" mask="#grad">
    <text slot="titulo" class="title" />
    <text slot="subtitulo" class="sub" />
  </group>
  <vector src="assets/logo.svg" class="logo" />
</frame>

<frame format="story" extends="feed" />

<style>
  :root { --color: var(--slot-cor); }
  .bg    { x: 0; y: 0; w: 100%; h: 100%; }
  .grad  { x: 0; y: 0; w: 100%; h: 100%;
           fill: linear-gradient(180deg, #00000000 0, #000000cc 1); }
  .title { x: 64; y: 720; w: 952; font: 700 72px/1.05 "Inter"; color: white; }
  .sub   { x: 64; y: 880; w: 952; font: 400 36px/1.2 "Inter"; color: white; }
  .logo  { x: 64; y: 64; w: 200; h: 60; }
  @format story { .title { y: 1400; font-size: 96; } .sub { y: 1600; } }
  @if slot(imagem) is empty { .title { y: 400; } }
  @each slide { .sub { overflow: shrink; } }
</style>
```

**Tags**: `frame`, `group`, `rect`, `text`, `image`, `vector`, plus `define` and `use`, which
draw nothing and are described under [Components](#components-define-and-use). Only `group`
holds other tags, and only `frame` and `define` sit at the top level. **There is no text
content** — a template draws slots, and words between two tags are `E_SYNTAX`.

**Attributes.** Every drawable tag takes `id`, `class`, `name`, `opacity`, `blend`, `mask`,
`clip`; `text` and `image` also take `slot`; `image` also takes `src` and `fit`; `vector`
takes `src`. A `frame` is not a node and takes its own set: `format`, `extends`, `bg`, `id`,
`class`. Anything else is `E_UNSUPPORTED_ATTRIBUTE` with a suggestion. Where an attribute and
a CSS property say the same thing (`opacity`), **the stylesheet wins** — the attribute is the
shorthand and a rule is the override.

**Accepted CSS properties**: `x y w h rotation anchor`, `font font-size font-weight
line-height letter-spacing color text-align vertical-align overflow`, `fill stroke radius`,
`opacity mix-blend-mode`, `shadow blur`, `visible`. Any other property is
`E_UNSUPPORTED_CSS` with a suggestion. The shapes the compound ones take:

| Property         | Written as                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `font`           | `700 72px/1.05 "Inter"` — weight and `/line-height` optional; the family needs **double** quotes                               |
| `fill` / `color` | `#ff5900`, a CSS basic colour name, `linear-gradient(180deg, #000 0, #fff 1)`, `radial-gradient(0.5 0.5, 0.7, #000 0, #fff 1)` |
| `stroke`         | `2px #ffffff` with an optional `inside` / `center` / `outside`                                                                 |
| `shadow`         | `0 4 12 #00000088`, or `0 4 12 2 #00000088` with a spread                                                                      |
| `radius`         | `8`, or `8 8 0 0` for `[tl, tr, br, bl]`                                                                                       |
| `anchor`         | `center`, `0.5`, or `0.5 1`                                                                                                    |
| `visible`        | `true` / `false`                                                                                                               |

**Units**: `px`, `%`, `vw`, `vh`, and a bare number means `px`. `vw` and `vh` are always of
the frame. `%` is of the nearest ancestor that declared a size, and of the frame otherwise —
a group has no size in the IR, so a `w` on a group is used as its children's percentage base
and stored nowhere.

**Colour names** are the CSS basic set (`white`, `black`, `red`, …, `transparent`) and
nothing more. A template's own palette belongs in `:root` as a variable, where the name means
what this template says it means.

**Selectors**: `.class`, `#id`, a tag name, and `:root`. Parts of one selector are written
together — `.title.destaque` — and there is no descendant combinator, so the space between two
parts means nothing. **There is no specificity**: declarations apply in the order they are
written and the last one to set a property wins, at-rule blocks included. That is why
`@format story` goes after the base rules in the example above; move it above them and it
stops overriding anything.

**Variables**: `:root { --brand: #ff5900; }`, read back as `var(--brand)`, with an optional
fallback (`var(--brand, #000)`). Custom properties are read **only** from `:root`, which may
sit inside an at-rule block; anywhere else is an error. Every enum in play is seeded as
`--slot-<name>` before the stylesheet runs, so `var(--slot-cor)` holds the word `laranja`.

**`extends`** on a frame inherits the tree of the frame it names, and its `bg` unless this
frame writes its own. A frame either extends another or has children of its own, not both.

**`mask="#grad"`** names an `id` in the same frame. Ids are unique across a whole scene, so an
explicit `id` is namespaced with `context.idPrefix` on the way into the IR: `grad` in the
markup is `slide-1.feed.grad` in the scene. It also means a mask may not name one of the
masked node's own descendants (`E_SCENE_MASK_DESCENDANT`), which is why the `<rect id="grad">`
above is a sibling of the group it masks rather than a child of it.

**`src`** on `image` and `vector` is a path relative to the template folder, resolved by
whoever loaded the template and handed in `assets`; `template-lang` is pure and reads no
files. `{slot}` interpolates: `src="{imagem}"` alone on an `image` is that slot's asset, and
`src="assets/{cor}.png"` splices an enum's word into a path.

### Components: `define` and `use`

A block written once and drawn where it is named. `<define name="…">` sits at the top level
beside the frames, in any order; `<use component="…">` goes wherever a node may appear,
including inside another `<define>`.

<!-- prettier-ignore -->
```html
<frame format="feed" bg="#0c2340">
  <use component="chip" class="first" />
  <use component="chip" class="second" />
</frame>

<define name="chip">
  <group class="chip">
    <rect class="chip-bar" />
    <text slot="titulo" class="chip-label" />
  </group>
</define>

<style>
  .chip       { x: 80; }
  .chip.first { y: 100; }
  .chip.second{ y: 340; }
  .chip-bar   { x: 0; y: 0; w: 96; h: 12; fill: #ff5900; }
  .chip-bar.second { fill: #ffd166; }
  .chip-label { x: 0; y: 32; w: 800; font: 700 36px/1.2 "Source Sans 3"; color: white; }
</style>
```

**A `<use>` is replaced by the component's tags**, before anything else reads the file. There
is no wrapper: the scene is the one the block written out twice by hand produces, node for
node. Which is also how to read a component — as a copy-paste the file does for you.

**The classes on a `<use>` land on every node of the expansion**, however deep. `second` above
is written on the `<use>` and read by `.chip-bar.second`, three levels down. That is how an
instance is overridden: this language has no descendant combinator and no specificity, and a
class that is ambient over an expansion is the same shape a flag adjustment already has over
an artwork (`.item.destaque`). ADR 0022 records the reasoning.

**A `<define>` writes no `id`.** An id is unique across a frame and a `<use>` may be written
twice, so a component's nodes are identified by position, like every other node that writes no
id. A `mask="#grad"` therefore names a `<rect id="grad">` outside the component.

**A component takes parameters, and a parameter is a slot name.** `params="texto"` on the
`<define>` declares one; `slot="texto"` in its body names it; `texto="titulo"` on the `<use>`
decides which slot that instance draws. Every attribute on a `<use>` other than `component`
and `class` is a binding.

<!-- prettier-ignore -->
```html
<frame format="feed">
  <use component="linha" class="topo" texto="titulo" />
  <use component="linha" class="base" texto="subtitulo" />
</frame>

<define name="linha" params="texto">
  <group class="linha">
    <rect class="linha-marca" />
    <text slot="texto" class="linha-texto" />
  </group>
</define>
```

The substitution happens **before** anything validates the tree, so nothing downstream knows
a parameter existed: `slot="rodape"` written by hand and `texto="rodape"` bound to a
component are the same undeclared slot, with the same `E_TEMPLATE_MARKUP`. The range is the
binding's, because the `<define>` is correct and the `<use>` is not. `renderedSlots` counts a
slot reached only through a parameter, so `W_UNUSED_SLOT` does not fire on it.

Three places in a body name a slot, and a parameter is substituted into all three: `slot="…"`,
a `{…}` spliced into a `src`, and a nested `<use>`'s own binding — which is how a parameter is
handed one component further down.

**A `<define>` takes `name` and `params`; a `<use>` takes `component`, `class` and one
attribute per declared parameter — anything else is refused.** So are an unknown component
name and an unknown parameter name (each with a suggestion), a parameter nothing binds, a
parameter bound to nothing, a `<use>` that runs in a circle, a second `<define>` under one
name, an empty `<define>`, a `<define>` written anywhere but the top level, and a `<use>`
written at it. A component nothing draws yet is checked anyway, because `tyto template check`
is run while a template is being written.

A parameter may not be called `component` or `class`, which a `<use>` spends on itself, and
may not carry the name of a slot the manifest declares — `slot="titulo"` inside that body
would mean the parameter and could never reach the slot.

**A component still does not decide how many of itself there are.** Two `<use>` are two tags
somebody typed. A carousel whose number of cards depends on how many items the brief brought
is still a `template.ts`.

Components live inside one template. There is no library shared between templates, which is
the point at which a component's classes could collide with its host's; nothing needs one yet.

### Slots, adjustments and marks

The reasoning behind the three rules below — why a mark reads a class, why an enum does not,
and why an enum needs `@if` to reach a value — is ADR 0017.

- `slot="x"` on `text` draws the rich text; on `image` it draws the asset. **A slot the brief
  left unset leaves its node out of the scene** rather than drawing an empty one, which is
  what makes `@if slot(x) is empty` worth writing.
- A **flag** adjustment becomes a class: `{destaque}` gives `.destaque`. It is _ambient_ — it
  is on every element of that artwork — so a rule that wants one writes it beside the
  element's own class: `.slide.destaque { … }`. A bare `.destaque { … }` applies to every
  node.
- An **enum** adjustment or slot becomes a variable: `{cor: laranja}` gives
  `--slot-cor: laranja`, with an adjustment on this artwork winning over a slot of the same
  name. To turn that word into a value, branch on it:
  `@if slot(cor) is laranja { :root { --bg: #ff5900; } }`.
- A **mark** in the brief's rich text takes the run properties of the class that spells it
  out: `{cor:laranja}Turma nova{/}` reads `.cor-laranja`, and `color`, `font`, `font-size`
  and `font-weight` from that rule land on those runs. A mark nothing spells out passes its
  text through unchanged — and, because unchanged styling is indistinguishable styling, its
  text rejoins the runs around it rather than splitting them. Guessing `{cor:roxo}` in a
  template that has no `.cor-roxo` costs nothing in the exported file.

### The at-rules

- **`@format <id>`** — the block applies while rendering that format. The id has to be one
  the manifest renders.
- **`@if slot(<name>) is empty`** — the block applies while the brief set no value for that
  slot. **`@if slot(<name>) is <value>`** — the block applies while the enum `<name>` holds
  `<value>`. The second reading is the only way an enum reaches a value: `--slot-cor` holds
  the word `laranja`, and no amount of `var()` turns a word into `#ff5900`.
- **`@each <slot>`** — a **scope, not a loop** (ADR 0017). `compile` already calls the template once per
  (artwork, format) with the repeatable slot resolved to _this_ artwork's occurrence, so
  there is nothing left to iterate. The block applies while rendering an artwork that slot
  produced: every artwork of a brief that filled it, and none of the single artwork a
  manifest with no repeatable slot produces. `<slot>` must name the manifest's repeatable
  slot.

At-rule blocks hold style rules, not other at-rules.

### What the markup cannot do

Compose text the brief did not write. A slide that numbers itself `2/3` is arithmetic on
`context.artwork`, and the markup draws slots — that template is a `template.ts`. The same
goes for a grid whose column count depends on how many items there are, and for anything else
the next section calls computation.

### Writing one in the editor

`@tyto/editor` opens a `template.html` as its second language (`language: 'template'`), on
the same Lezer grammar `compileTemplate` parses with and the same `templateHighlighting`
table that lives beside it. There is one tree and one colour table, so the editor and the
compiler cannot disagree about what a tag is.

**The lint markers are `compileTemplate`'s own diagnostics.** The editor runs the compiler
and throws the compiled template away, keeping only what it said. Running it is safe in a
way a brief's `compile` is not: compiling a _template_ reads markup, where compiling a
_brief_ executes a template — which is why the brief side of the editor stops at `resolve`
and this side does not.

**A template is checked against its own manifest and no other.** A brief names its template
in the frontmatter; a `template.html` is the file in the folder beside a `manifest.yaml`,
and the host that opened the file is the only thing that knows which. A host that cannot say
should not lint the buffer rather than lint it against a guess — every `slot="…"` in the
file depends on the answer.

**Completion comes out of `vocabulary.ts` and nowhere else**: tag names after `<`,
attribute names for the tag being written, and CSS properties inside `<style>`. Those three
lists are the same arrays `compileTemplate` refuses against, so a name the editor offers is
a name the compiler accepts, by construction rather than by both being kept in step.

**`slot="…"` is the fourth list, and the only one a manifest decides.** It offers every slot
the manifest declares — the same one the buffer is being linted against, published to the
editor state by `templateLint` so the squiggle and the list cannot disagree about which
template the file belongs to. Every slot and not the ones whose type suits the tag: naming an
image slot on a `<text>` is not an error, the node is simply left out of the scene, and a
list that hid names the compiler accepts would be inventing a rule. The type is shown beside
each name instead. Nothing is offered on a tag that does not take `slot` at all. Values other
than a slot name are still not completed: `fit="` suggests nothing.

**Where the cursor is comes from the syntax tree, not from the text before it.** The source
resolves `syntaxTree(state).resolveInner(pos, -1)` and answers by node, which is what tells
the two halves of the file apart — a `StyleSheet` node rather than a backwards scan for the
nearer `<style`, and a `>` already written puts the cursor outside the opening tag rather
than inside it. One text match survives and the place it survives says why: the grammar has
no unterminated string, so `slot="ti` parses as an unclosed quote followed by a bogus
attribute called `ti`. The tree still says which attribute the quote belongs to, so that is
what it is asked for, and the characters since the quote are read from the document. A `<`
typed inside a value is therefore a character in a value and not the start of a tag.

**A quick fix has two sources, because there are two kinds of mistake.** `colour` is a typo
and edit distance finds `color`. `background` is not a typo of anything — nobody arrives at
this language without CSS in their fingers — and only the hand-written alias table knows it
means `fill`. `propertyAlias`, `tagAlias` and `attributeAlias` expose the table filtered to
the entries that are one accepted name, so the multi-word ones ("x, y and rotation") stay in
the message, which is where a sentence belongs.

**An attribute's suggestion depends on the tag it sits on, and the editor reads that off the
tree.** `E_UNSUPPORTED_ATTRIBUTE` names the tag in its message but does not carry it as a
field, and widening the diagnostic so one consumer could read one would be the wrong repair:
the editor already has the document parsed, so it climbs from the range to the enclosing
`Element`. `object-fit` is offered as `fit` on an `<image>` and refused on a `<rect>`, which
does not take it.

### `renderedSlots`

`compileTemplate` returns the set of slots the template **reads**, alongside the manifest and
the build function. Hand it to `resolve` as `renderedSlots` and a brief that fills a slot the
template ignores gets `W_UNUSED_SLOT`. The code path cannot report this — a plain function
call does not say which slots it touched — which is why the warning stays silent unless a
caller supplies the set.

Reads, not draws. A slot counts when it reaches the output by any of four routes:

| Route                                      | Example                                                                |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| a `slot` attribute                         | `<text slot="titulo" />`                                               |
| a slot spliced into a `src`                | `src="{imagem}"`, `src="assets/{cor}.png"`                             |
| an at-rule condition                       | `@if slot(cor) is laranja`, `@if slot(imagem) is empty`, `@each slide` |
| the seeded variable, however deeply nested | `var(--slot-cor)`                                                      |

The middle two are never drawn and still decide what comes out, which is the whole point:
a template whose background is `@if slot(cor) is laranja { :root { --bg: #ff5900 } }` is
using `cor`, and telling its author the slot is unused tells them to delete the line that
makes the template work.

A slot a component reaches through a parameter counts through the first route, not a fifth
one: `texto="subtitulo"` on a `<use>` is `slot="subtitulo"` by the time anything counts.

One case deliberately counts as no reference: a conditional block with nothing inside it.
`@if slot(cor) is laranja { }` changes no output, so the slot in its prelude really is used
by nothing.

## template.ts — code path

```ts
import { defineTemplate, frame, group, text, image } from '@tyto/core/template';
export default defineTemplate(manifest, ({ slots, format, adjustments }) => frame({...}));
```

Same nodes, same output. Use it when you need computation (text auto-fit, dynamic grids).

**`docs/template-conventions.md` is how to organise one.** It settles the parts this section
leaves open: how the YAML manifest reaches the module — it is not imported, and the sketch
above is the shape a _test_ uses — where tokens and reusable parts live, and what
arrangement a template composes with (`@tyto/template-kit`). Read it before writing a
second template, because the conventions are what make the second one cheaper than the
first.

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

### How a code template reaches a render

**Nothing loads it from a folder, and that is deliberate.** Dropping a `template.ts` beside a
`manifest.yaml` makes it inert: the registry reads manifests and executes nothing, and
`markupTemplateSource` refuses to import code because running code that arrived in a folder
is the plugin host's job, with its permissions and its isolation (ADR 0007).

What runs is code **compiled into the application**. `BUILT_IN_TEMPLATE_BUILDS` in
`@tyto/templates` maps a manifest name to its build function, and `bundledTemplateSource`
pairs each with the manifest the registry already parsed. The CLI and the desktop compose it
in front of the markup route, so a name the build does not ship reaches markup unchanged.

A name that is **both** — shipped code and a `template.html` in its folder — is
`E_TEMPLATE_AMBIGUOUS` rather than a winner picked quietly. A silent winner is a template
that changes behaviour the day somebody edits the file it was ignoring.

### `W_UNUSED_SLOT` does not fire for a code template

A brief that fills a slot the template never draws is worth a warning, and on the markup
route it gets one: `compileTemplate` derives `renderedSlots` by reading the body.

**A function has no body to read**, so a code template carries no `renderedSlots`, and
`resolve` is told nothing rather than told "none". The warning therefore never fires on this
route. Read the silence as _nobody checked_, not as _every slot is drawn_ — it is the same
distinction `renderedSlotsOf` makes by answering `undefined` instead of `[]`.

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

## Previewing a template while you write it

```bash
pnpm template:preview agenda-semana
```

**Each image on the page is the file `tyto render` wrote, byte for byte — Playwright's
Chromium with the determinism flags. It is not byte-identical to the desktop app's export
for text, whose Chromium draws glyphs differently (ADR 0028).**

`tools/template-preview` serves `http://127.0.0.1:4174/` and draws the template again every
time a file in its folder is saved. The argument is a name in the built-in pack or the path to
a template folder of your own; `--brief <file>` picks the brief (default: the first
`examples/*.brief`), `--types png,svg` the outputs, `--port <n>` the port. It listens on the
loopback address and on nothing else, because it serves unreleased artwork.

**It is not a renderer, and that is the whole design.** A preview that is close to the output
is a second renderer, and the day the two disagree the preview is the one that lied. So the
tool draws nothing: every render is `node apps/cli/dist/index.js render <brief> --out … --json`
in a child process, and the page is an `<img>` per file that command wrote, served as the
bytes on disk. `no-renderer-of-its-own.test.ts` holds it to that by its imports — no `@tyto/*`
package at all — and `preview.visual.test.ts` compares the sha256 of every image the server
sends with a separate `tyto render` of the same brief, for `agenda-semana` and `promo-curso`.
Breaking the CLI's render path breaks the page with it, which is the point.

What a save does depends on the file:

- **Markup, a manifest, an asset, the brief** — one `tyto render`. About 1.3 s from save to
  image on the maintainer's win32 machine.
- **A `.ts` in a template compiled into the build** — `@tyto/templates` is rebuilt first,
  because the CLI imports `BUILT_IN_TEMPLATE_BUILDS` from its `dist/` (TYTO-166). The rebuild
  is tsup with the package's own config minus declarations, which writes the same
  `dist/index.js` a full `pnpm build` does and takes under a second instead of eleven. About
  2.5 s from save to image. A `template.ts` in a folder of your own stays inert, exactly as
  `tyto render` leaves it (ADR 0007), and the page shows the diagnostic `tyto render` gives.

**A failure shows its diagnostics and no image.** A build error is esbuild's message at its
file, line and column; a markup or template error is what `tyto render --json` printed. The
picture from before the failure is removed from the page and its URL answers 404, so a stale
image cannot pass for the current one. While a build is broken every save rebuilds, even a
save that would not need to, because the `dist/` on disk is still the code from before.

`/api/state` is the same state as JSON — generation, status, every image's format, path, URL,
byte count and sha256, the diagnostics, the command that ran and how long the build and the
render took — for an agent driving the page, or anything else.

The page shows the formats the brief renders. The example briefs list every format their
manifest declares; a brief that names fewer gets fewer.

## Agent workflow

1. Read `manifest.yaml` and this document.
2. Write `template.html`.
3. Run `tyto template check templates/<name>` — returns diagnostics with line numbers.
4. Run `tyto render examples/<name>.brief --template <name> --out /tmp/x` and inspect the PNG —
   or keep `pnpm template:preview <folder>` open and read `/api/state` after each save.
5. Iterate until `check` is clean and there is no `W_TEXT_OVERFLOW`.
