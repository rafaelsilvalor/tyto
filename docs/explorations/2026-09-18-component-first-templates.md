# Component-first templates, and the repetition the markup cannot do

Status: **exploration, not binding** · 2026-09-18 · continues TYTO-74 / TYTO-75 (E4.9, E4.10);
no card hosts it yet · see `docs/explorations/README.md`

Related, and where the settled parts already live: ADR 0022 (components are expanded before the
tree is read), ADR 0017 (the markup vocabulary, and the cascade it closed), ADR 0005 (an
HTML-like `template.html`), `docs/template-authoring.md`, `docs/backlog.md` E4.9–E4.10.

## Context

The question arrived from the design side rather than from the code: templates took real work
to produce, and the people producing them want to move faster. The proposal was
**component-first** — a template written mostly out of components, with the six drawable tags
as primitives underneath, arranged in a hierarchy the way a programming language arranges
classes and functions.

The proposal then answered itself, and the correction is the useful part of the session: it
does not pay unless the brief can reach an individual component — the text that goes _inside_
that one instance.

This note records what already exists, where the real gap is, and what it would take to close
it. **Nothing here is a decision.** ADR 0022 is, and it is not reopened by this note.

## What already exists, measured on 2026-09-18

Three of the four pieces the proposal needs are built and under test.

**Components, with parameters.** `packages/template-lang/src/components.ts` exports
`expandComponents`, called from `compile-template.ts:100`, and `DEFINE_ATTRIBUTES` is
`['name', 'params']` — so E4.10's content binding shipped alongside E4.9's structural reuse.
`<define>` and `<use>` are `STRUCTURAL_TAGS` and never `TagName`s: they are expanded away
before `build.ts` runs, and the IR receives a `group` indistinguishable from a hand-written
one.

**A repeatable slot.** A manifest may declare one — `carrossel-lista` has
`item: { type: rich-text, repeat: true, min: 1, max: 10 }`.

**Per-occurrence access from the brief, which is the thing the session assumed was missing.**
The same manifest declares `adjustments: destaque: { type: flag, applies: [item] }` and
`tom: { type: enum, values: [claro, escuro], applies: [item] }`. A brief marks _one_ occurrence
and it behaves differently from its siblings. That door is open and has been since E3.3.

## The gap, stated precisely

**A repeatable slot produces one artwork per occurrence, not several nodes inside one frame.**
Ten items are ten carousel slides. There is no way in the markup to draw ten cards in a single
artwork with the count coming from the data.

`@each` is the trap in this area, and the name is why. It reads like repetition and is a
**style guard**: `style.ts:27` types it as `{ kind: 'each'; slot: string }`, `style.ts:167`
builds it, and `style.ts:295` resolves it as `conditions.repeatable === guard.slot` — a
condition that turns a block of rules on. It decides appearance and never produces a node.

`docs/backlog.md` already names the consequence without deciding it: _"a grid whose column
count depends on the data is still a `template.ts`."_ That sentence is the agility problem in
one line — the case falls out of the markup and into a TypeScript template, which is exactly
the path a designer cannot take.

So the honest restatement of the proposal is not _make templates component-first_. It is:
**give the markup data-driven repetition inside a frame, and give the brief a way to address
the N-th copy.**

## The missing piece, and why it is small

| piece                                               | state on 2026-09-18        |
| --------------------------------------------------- | -------------------------- |
| expansion above the tree read                       | built — `expandComponents` |
| parameters binding content to an instance           | built — `params`           |
| repeatable slot                                     | built — `repeat: true`     |
| per-occurrence adjustment from the brief            | built — `applies: [item]`  |
| **a `<use>` that repeats over the repeatable slot** | **absent**                 |

The shape would be something like `<use each="item" component="card" texto="item">` — the
`@each` that exists in the stylesheet, raised into the markup. It is cheap for the reason ADR
0022 gives for the rest of the feature: expansion happens above `build.ts`'s
`switch (element.tag)`, so the grammar does not change, the IR contract does not change, and no
exporter learns anything.

**What is not cheap is identity, and it is the one genuinely open problem.**

A `<define>` may not write an `id` (ADR 0022), because a `<use>` may be written twice and the
id would collide with itself. Positional ids sidestep that — `assignIds` derives `…0.0` and
`…1.0` from the tree — and they would sidestep it for ten data-driven copies too. But an
adjustment from the brief has to _find_ the third copy, and the match between an adjustment and
an occurrence exists today for an **artwork**, not for a node inside a frame. Repetition without
that match produces ten identical cards, which is a worse answer than the `template.ts` it
replaces.

## What component-first, in its strong form, would reopen

Recorded so the next person does not re-derive it.

**Inheritance.** An instance overrides by a class propagated to every node of the expansion
(`.chip.second`), not by a descendant combinator (`.second .chip-bar`). ADR 0017 closed the
combinator and ADR 0022 says components are precisely the pressure that would reopen it: a
combinator needs a second cascade to resolve, and this language has no specificity — the last
declaration wins. Classes and objects in the OO sense bring that problem back.

**A component library across templates.** Deliberately out of scope in ADR 0022: a component's
classes are the template's classes in one flat namespace, so sharing across templates forces
CSS scoping, and scoping had no consumer.

**Masks inside components.** A mask needs an explicit `id`, which a `<define>` may not write, so
a mask's target stays outside the component. Cheap at today's size; expensive in a world where
almost everything is a component.

## Audit — what was measured, when, and how

Measured on 2026-09-18 against `main` at `e308855`. Line numbers are a snapshot and rot.

```
$ grep -c "<define\|<use" packages/templates/templates/*/template.html
carrossel-lista/template.html:0
promo-curso/template.html:0

$ drawable tags per template
promo-curso: 8      carrossel-lista: 6

$ grep -c "it(" packages/template-lang/src/compile-template.test.ts
80
```

**Zero of two shipped templates use the component mechanism.** ADR 0022 predicted this outcome
in writing — it measured 0 repeated subtrees across both templates, called itself a feature
shipped ahead of its evidence, and said that if no consumer arrived "the honest reading is that
the measurement above was right and this entry was premature." Five days later none has.

That matters for this note in a specific way: **the mechanism the proposal wants to build on has
never been exercised by anybody.** A design that extends it is extending something untried.

## Open questions

1. **How does a brief address the N-th copy of a component inside one frame?** Adjustment-to-
   occurrence matching exists for artworks. Nothing decides it for nodes. This is the question
   that makes or breaks the whole direction.
2. **`extends` and `define`/`use` both exist and nothing says which resolves what.** One is
   inheritance of a whole template (E4.3's vocabulary), the other composition of a piece. Two
   solutions to one problem is how "it depends who wrote it" starts.
3. **Does the duplication designers actually hit live in the markup or in the stylesheet?** ADR
   0022 measured the markup and found zero; the duplication it _did_ find was 5 declarations in
   `promo-curso`'s CSS, removable today with a selector list. A component touches none of that.
   If the designers' pain is the stylesheet, components are the wrong tool and the measurement
   should be redone against their real files, not the two built-ins.

## What this note did not measure

- **No test was run.** The claim that `@each` produces no node comes from reading the `Guard`
  type and `activeRules`, not from executing anything.
- **No designer's real template was read.** Everything above is measured against the two
  built-in packs, which ADR 0022 already flagged as a thin sample.
- **The cost of the missing `<use each>` is not estimated.** It is argued to be small from where
  expansion sits in the pipeline; nobody has written it.

## The cheapest next step

Take a layout the designers have already produced that today forces a `template.ts` — a card
grid whose count comes from the data — and write the manifest and the markup they _wish_ they
could write, without making it compile. That file turns "components with more flexibility" into
a card with an acceptance criterion, and it answers open question 3 as a side effect: if the
wished-for file is mostly stylesheet, this whole direction is aimed at the wrong duplication.
