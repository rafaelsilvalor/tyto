# The box and the arrangement, and where each one is already half built

Status: **exploration, not binding** · 2026-09-20 · companion to
`docs/explorations/2026-09-18-component-first-templates.md`; no card hosts either ·
see `docs/explorations/README.md`

Related, and where the settled parts already live: ADR 0003 (the brief compiles to a Scene IR),
ADR 0017 (the markup vocabulary, and the cascade it closed), ADR 0018 (what an exporter does
where the IR left a question open), ADR 0022 (a component is expanded before the tree is read),
ADR 0023 (the SVG export states geometry, not intent), `docs/ir-schema.md`,
`docs/template-authoring.md`.

## Context

The question arrived as three, from the maintainer, about how a brief and a template divide the
work. Two of them are answered by reading and need no note:

**The template carries the definitions, and it _adds_ options to the brief rather than
implementing options the brief already had.** `brief-lang` reserves exactly two frontmatter keys,
`template` and `formats` (`RESERVED` in `packages/core/src/brief/resolve.ts`). Every other key and
every `::directive` is checked one at a time against the chosen template's `manifest.yaml`.
`::titulo` is not a word in the language; it exists because `promo-curso` declares a `titulo`
slot. Choosing a template chooses what the brief is allowed to say.

The third question is the exploration: **what building blocks are missing before "component" pays
off** — the sense in which Figma has a frame, a section and auto-layout underneath its components.

That question is three axes, not one, and they differ in cost by an order of magnitude:

| axis                    | what it is                                                         | state         |
| ----------------------- | ------------------------------------------------------------------ | ------------- |
| **A — the box**         | a container with a rectangle of its own: clips, anchors, hosts `%` | half built    |
| **B — the arrangement** | auto-layout: direction, `gap`, `padding`, hug and fill             | absent        |
| **C — the reuse**       | `<define>` / `<use>`                                               | built, unused |

**Axis C is not reopened here.** The 2026-09-18 note measured it and concluded that its blocker is
_identity_ — how a brief addresses the N-th copy inside one frame — and not layout. This note
measures A and B, which nobody had measured.

**Nothing here is a decision.**

## What the IR has today, measured on 2026-09-20

**Five drawable nodes and one positioning primitive.** That is the whole vocabulary a template can
reach for.

```
$ grep -n "export type SceneNode" packages/core/src/scene/nodes.ts
190:export type SceneNode = GroupNode | RectNode | TextNode | ImageNode | VectorNode;
```

`transformSchema` (`packages/core/src/scene/primitives.ts`) is `x`, `y`, `rotation`, `scaleX`,
`scaleY`, `anchor`. There is no second way to place a node, and every number that reaches the IR
is an absolute pixel of the frame.

**No container layout exists in the IR schema at all.**

```
$ grep -rnE "\b(flex|gap|padding|margin|stack|constraint|auto-?layout|hug|grid)\b" packages/core/src/scene/
(no matches)
```

The one near miss is worth naming so nobody re-runs the search and misreads it: `justify` appears
once, in `textAlignSchema` (`nodes.ts:43`), as a way of setting type. It is not a container
property.

**A group is a transform and a list.** `groupNodeSchema` (`nodes.ts:192`) is `baseShape` plus
`kind` plus `children`. No `size`. Two places in the codebase already carry the consequence in
prose:

```
$ grep -rn "group has no box" packages/core packages/export-html
packages/core/src/scene/bounds.ts:88: * empty. A group is the union of its children and nothing more: a group has no box.
packages/export-html/src/html.ts:304:    'a group has no box in the IR, so there is nothing to clip to; put the flag on the rect or image that defines the box',
```

## Axis A — the box exists in the language and is erased at the IR boundary

This is the correction that makes the axis worth writing down. It is not true that Tyto has no
notion of a container box. **It has one, in the template language, and deliberately does not store
it.** From `packages/template-lang/src/build.ts`, above `groupNode`:

```
/**
 * A group that declares a size becomes the box its children's percentages are of.
 *
 * The IR gives a group no size — it is a transform and a list — so the number is used and
 * not stored. That is the whole reason `%` is documented as "of the nearest ancestor that
 * declared one, and the frame otherwise": there is nothing else for it to be of.
 */
```

So `<group w="600">` is already a box while the template builds, and stops being one the moment
the IR is written. The same file says it again from the other side, in `readEveryProperty`: _"a `w`
on a `<text>` becomes a box, a `w` on a `<group>` becomes a percentage base and nothing else."_

What that erasure costs, today, measured rather than supposed:

1. **`clip` on a group is ignored** and reported as `W_EXPORT_APPROXIMATED` — ADR 0018 decided
   that, and `html.ts:304` is the message. A `<div>` that cannot clip is the opposite of a `<div>`.
2. **`anchor` on a group has nothing to be relative to.** `visitor.ts:90` returns `{ w: 0, h: 0 }`
   as the group's anchor box, so rotating a group turns it about its origin and never about its
   centre.
3. **`%` cannot be resolved by anything downstream**, because the base was thrown away. Every
   consumer of the IR sees absolute pixels and cannot re-derive the intent.

**The cost of closing it is a field, not a `kind`.** `GroupNode` gaining an optional `size` adds no
sixth node, so `switch (element.tag)` in `build.ts` is untouched. What it does touch is the
`SceneVisitor<T>` contract — two exporters, five methods each — the mapping table in
`docs/ir-schema.md`, and ADR 0018's reasoning for ignoring `clip`, which was _"there is nothing to
clip to"_ and would stop being true.

## Axis B — the cheap path has a precedent, and a rock the precedent did not hit

The precedent is ADR 0022. Components are expanded **above** the tree read, so the grammar, the IR
contract and both exporters learned nothing. The same shape is available here: **auto-layout as a
template-language feature, resolved to absolute pixels during build, costing the IR nothing.** It
fits how the language already behaves — `%`, `var()` and `@if` all resolve at build and none of
them reach the IR.

**The rock is that a container which hugs its content needs the content measured, and text is
measured after the template has already built.** Both calls are in one loop in
`packages/core/src/brief/compile.ts`:

```
$ grep -nE "\.build\(|layoutText" packages/core/src/brief/compile.ts
265:        frame = template.build(context);
286:          children: layoutText(frame.children, faces, plan.slots, format, problems),
```

By line 265 the template has already decided every coordinate. Line 286 is where `measureText`
runs. A group that wants to be as tall as the text inside it needs at 265 a number that does not
exist until 286.

**And the measurement is never stored, which makes it worse than an ordering problem.**
`layoutText` returns the node with two changes and no third: the runs arrive with line breaks
decided, and an `overflow` of `'shrink'` becomes `'clip'`. It does not write a measured height back
into `box`, whose `w` and `h` stay optional and stay whatever the template wrote — _"an absent
dimension means 'as large as the content needs'"_ (`nodes.ts:131`). So even after measurement,
nothing in the IR records how tall the text actually came out.

Two further details that bound the problem:

- `layoutText` only runs `if (faces !== undefined)`. A build with no font cache never measures
  anything, and the node keeps the lines the template wrote.
- `measureText` lives in `packages/core/src/text/layout.ts` and is pure, so it is reachable from a
  build in principle. The obstacle is the order and the missing field, not the runtime boundary.

Which splits axis B cleanly in two, and only one half is cheap:

| kind of arrangement                                      | cost                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------- |
| fixed-size containers: direction, `gap`, `padding`, fill | template-language only; the IR is untouched                 |
| containers that hug their content                        | needs measurement during build **and** somewhere to keep it |

## What this would reopen

Recorded so that the next person does not re-derive it.

**The first design directive, pressed from the unusual side.** `docs/architecture.md` says _"the IR
is the single source of truth for the artwork. If it is not in the IR, it does not exist."_
Resolving layout in the template means the layout _intent_ never reaches the IR — only its result.
That is not a new departure: ADR 0023 already decided exactly this for SVG, which _"states
geometry, not intent"_, because importers discard instruction. The note's reading is that a
build-time auto-layout extends a decision already taken rather than contradicting one. Somebody
should disagree with that in writing if they disagree.

**ADR 0018's reasoning for ignoring `clip`.** It rests on a group having no box. Give it one and
the decision needs revisiting — not reversing, revisiting.

**Two mechanisms becoming three.** The 2026-09-18 note left open that `extends` (whole-frame
inheritance) and `define`/`use` (piece composition) coexist with nothing saying which resolves
what. A container that arranges its children is a third thing in the same neighbourhood.

## Audit — what was measured, when, and how

Measured on 2026-09-20 against `main` at `c339725`, clean tree except the two uncommitted
exploration notes. Line numbers are a snapshot and rot.

```
$ git rev-parse --short HEAD
c339725

$ grep -rnE "\b(flex|gap|padding|margin|stack|constraint|auto-?layout|hug|grid)\b" packages/core/src/scene/
(no matches)

$ grep -rn "justify" packages/core/src/scene/
packages/core/src/scene/nodes.ts:43:export const textAlignSchema = z.enum(['left', 'center', 'right', 'justify']);

$ grep -nE "\.build\(|layoutText" packages/core/src/brief/compile.ts
265:        frame = template.build(context);
286:          children: layoutText(frame.children, faces, plan.slots, format, problems),

$ grep -c "<define\|<use" packages/templates/templates/*/template.html
carrossel-lista/template.html:0
promo-curso/template.html:0

$ drawable tags per template
carrossel-lista: 6      promo-curso: 8
```

The last one is re-measured rather than quoted from the 2026-09-18 note: **zero of two shipped
templates use the component mechanism**, still, two days later and five commits on. Any proposal
here inherits that — the three axes are being designed for a template nobody has written yet.

## A real layout, and what it does to the argument above

Added the same day, after the section above was written. The maintainer supplied a production
carousel slide — an Estratégia "Agenda da semana" — annotated by hand into three kinds of region:

- **blue**: fixed on every slide (the owl header, the `@estrategia.saude` footer and its arrow)
- **green**: fixed on the first slide only, and never changes (the calendar emoji and the title)
- **red**: varies from slide to slide (a discipline heading, then a list of session rows, each row
  a date pill beside a grey pill holding a session title and a professor's name)

**This is the first real layout measured against the three axes, and it contradicts the cheap
reading of axis B.** Counted by hand from the image, drawn as one slide:

| what                                           | count             |
| ---------------------------------------------- | ----------------- |
| drawable nodes in the slide                    | 27                |
| of those, the four session rows (5 nodes each) | 20                |
| drawable tags in the largest shipped template  | 8 (`promo-curso`) |

So the sample is **27 nodes against a 8-node high-water mark**, and **20 of its 27 nodes are four
copies of one five-node subtree**. That is the duplication the 2026-09-18 note went looking for in
the built-ins and did not find. It is real; it just was not in the sample.

**What comes out of Tyto today, unchanged.** If the counts are frozen — exactly two disciplines,
exactly two rows each — the whole slide is writable in the markup right now, with the brief filling
titles, dates and names. Nothing in this note is needed for that.

**What does not come out is the variation**, and it fails on three separate things:

1. **The repetition is two levels deep.** N disciplines, each with M rows. A manifest may declare
   **at most one** repeatable slot (`manifest.ts:196`), and its occurrences become _artworks_, not
   nodes — so the one repeat available is already spent being "one slide per discipline", and the
   rows inside a slide have nothing left to repeat with.
2. **"First slide only" has no guard.** The stylesheet has five: `always`, `format`, `empty`,
   `value`, `each` (`style.ts:23-27`). None of them is the artwork index. The index _does_ reach a
   template — `compile.ts:258` passes `artwork: { id, index, count }` — but only a `template.ts`
   can read it; the markup never does, and `build.ts:898` hands the static check a hardcoded
   `index: 0, count: 1`. There is a workaround that works today and is worth naming because it is
   ugly: a per-occurrence adjustment (`applies: [item]`, ADR-era E3.3) lets the brief mark the
   first occurrence by hand. It relies on the author remembering.
3. **The layout is a hugging stack from top to bottom.** A grey pill's height depends on whether
   its session title wraps. A discipline block's height depends on its row count. And the second
   discipline's `y` **is** the first discipline's height. Every one of those numbers would have to
   exist at `compile.ts:265`, and the earliest any of them exists is 286.

**Point 3 is the one that costs this note an open question.** The section above offered "ship
arrangement for fixed-size containers only" as the cheap half, on the reasoning that it covers
grids and stacks. This layout is a stack, and the cheap half does not cover it: its stacking is
hug all the way up. One sample is not a survey, but it is one more than the argument had.

## The same layout decomposed into components, and what that buys

The maintainer's follow-up was to treat every region as a component — _"componentizar o que for para
facilitar adaptações"_. Worth doing on paper, because the decomposition is expressible today and the
bill it runs up is the argument.

Five components cover the whole slide. Nesting is legal: `docs/template-authoring.md` says a
parameter is substituted into a nested `<use>`'s own binding, "which is how a parameter is handed
one component further down".

<!-- prettier-ignore -->
```html
<frame format="feed">
  <use component="header" />                      <!-- blue  -->
  <use component="cover-title" />                 <!-- green -->
  <use component="discipline" nome="d1_nome"
       l1d="d1_l1_data" l1t="d1_l1_titulo" l1p="d1_l1_prof"
       l2d="d1_l2_data" l2t="d1_l2_titulo" l2p="d1_l2_prof" />
  <use component="discipline" nome="d2_nome" ... />
  <use component="footer" />                      <!-- blue  -->
</frame>

<define name="session-row" params="data titulo professor">
  <rect class="row-body" />
  <rect class="row-pill" />
  <text slot="data" class="row-date" />
  <text slot="titulo" class="row-title" />
  <text slot="professor" class="row-prof" />
</define>

<define name="discipline" params="nome l1d l1t l1p l2d l2t l2p">
  <text slot="nome" class="disc-name" />
  <use component="session-row" class="r1" data="l1d" titulo="l1t" professor="l1p" />
  <use component="session-row" class="r2" data="l2d" titulo="l2t" professor="l2p" />
</define>
```

**What it buys, counted.** The 27 hand-placed nodes become 5 `<define>` bodies and 5 `<use>` tags.
The five-node row is written once instead of four times. Per-instance adaptation works through the
mechanism ADR 0022 chose: `class="r2"` propagates to every node of the expansion, so `.row-pill.r2`
reaches the second row's pill through a compound selector. `docs/template-authoring.md:232`:
_"together — `.title.destaque` — and there is no descendant combinator"_.

**What it costs, counted.** A parameter **is a slot name**, substituted before anything validates
(`components.ts:25-30`). A component cannot be handed a value; it can only be handed the name of a
slot the manifest already declares. So the pictured slide needs one slot per field per occurrence:

| what                                  | promo-curso | the Agenda slide, componentised |
| ------------------------------------- | ----------- | ------------------------------- |
| slots declared in the manifest        | 4           | 14                              |
| of those, positional (`d1_l2_titulo`) | 0           | 12                              |
| params on the widest `<define>`       | —           | 7, and 13 at four rows          |

And the placement does not componentise at all. Every `<use>` still needs its own `x`/`y`, the
second row's `y` is the first row's `y` plus a height somebody typed, and the second discipline's
`y` is a number that depends on how many rows the first one had.

**Which is the finding.** Components collapse the _drawing_ and leave the _adapting_ where it was.
Adding a third session to a discipline today means editing the manifest (three new slots), the
`<define>`'s `params` list, the `<use>` that binds them, every `y` below the insertion, and the
brief. That is five files' worth of edit for one row, and it is the opposite of the stated goal.

The two things that would change that number are the two this note and the 2026-09-18 note have
been circling: **data-driven repetition**, so the row count comes from the brief instead of from the
manifest, and **arrangement**, so the `y` below an insertion is computed instead of typed. Neither
is a component feature. Components are the thing you want _after_ both exist — which is, in the
end, the same conclusion ADR 0022 reached from the other direction when it shipped the mechanism
and measured zero consumers.

## Open questions

1. **Does hug earn an inversion of the pipeline?** Measuring during build means a template that can
   ask "how tall is this text", which is a bigger change to what a template _is_ than everything
   else in this note. The section above offered fixed-size containers as a cheap half that covers
   grids and stacks; the Agenda sample is a stack that it does not cover. The question is now
   whether any useful layout is served by arrangement without hug, and one sample says maybe not.
2. **If a group gains a box, is it optional?** Optional keeps every existing template valid and
   creates two kinds of group, which is the shape of a decision that gets regretted. Required means
   migrating both built-ins and every template a designer has locally.
3. **Where does the number live once it is measured?** A measured height has no field in the IR
   today. Adding one to `TextNode.box` conflicts with `box` meaning "what the author asked for".
4. **Is the pain markup or stylesheet?** Inherited unanswered from 2026-09-18, and neither axis
   answers it. ADR 0022 measured the markup and found zero duplication; the duplication it found
   was five declarations in `promo-curso`'s CSS.

## What this note did not measure

- **No test was run and no prototype was written.** Every claim above comes from reading code and
  from `grep`. The ordering claim in particular — build at 265, measure at 286 — is read from one
  function, not observed at runtime.
- **No real designer's template was read.** The sample is the same two built-in packs that ADR 0022
  already flagged as thin.
- **The cost of giving `group` a box is not estimated in lines.** It is argued to be a field rather
  than a node, which bounds the blast radius without sizing it.
- **Fill and `gap` are assumed to be resolvable at build.** Nobody wrote the resolver; the claim
  rests on `%` already resolving there.

## The cheapest next step

Take one real layout and write the `template.html` a designer _wishes_ they could write, with a
box and an arrangement, **without making it compile**. The 2026-09-18 note proposes the same step
for axis C. Written together, the two wished-for files are the acceptance criterion for a card, and
they answer open question 4 as a side effect: if the wished-for file is mostly stylesheet, all
three axes are aimed at the wrong duplication.
