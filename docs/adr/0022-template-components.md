# 0022 — A component is expanded before the tree is read, and an instance overrides with a class

Status: accepted · 2026-09-13 · extends ADR 0017, which extends the markup path of ADR 0005

## Context

ADR 0005 chose an HTML-like `template.html`; ADR 0017 settled the two questions the parser
could not be written without and stopped there, on the grounds that designing more syntax
before a real template existed was guesswork. E4.4 then shipped the real templates, and
E4.9 (TYTO-74) is the entry that was gated on them: reusable components, `<define>` and
`<use>`, so that a block written once can be drawn three times.

**The gate asked for a measurement, and the measurement is zero.** Across the two built-in
templates there are 10 drawable tags — 6 in `promo-curso`, 4 in `carrossel-lista` — and **0
repeated subtrees**. No two nodes in either file draw the same thing: `veil` and `rule` are
both `<rect>` and share nothing, `title` and `sub` are both `<text>` and share nothing.

The duplication those two files _do_ contain is in the stylesheet, and a component does not
touch it. `promo-curso` writes `x: 0; y: 0; w: 100%; h: 620` twice, once for `.photo` and
once for `.veil`, and `h` twice more inside `@format story`: 5 duplicated declarations, all
of them removable today by writing `.photo, .veil { … }`, because a selector list is already
in the grammar.

So this is a feature shipped ahead of its evidence, which is worth writing down: the cost of
being wrong is bounded — the grammar does not change, the IR contract does not change, and
`build.ts` never learns the two tags exist — and the card is explicit that a DRY feature for
a template author is what it is for. What the measurement forbids is the larger version: a
component library shared between templates, with the CSS scoping that would force, has no
consumer at all and is out of scope here.

## Decision

**A component is expanded away above everything else.** `expandComponents` runs on the
parsed document before `collectFrames` sees it, and what leaves it is a document with no
`<define>` and no `<use>` — the tags the author would have typed by hand. Nothing downstream
learns a second way of holding children: `frames.ts` checks the same tree it always checked,
`build.ts`'s `switch (element.tag)` is untouched, and the IR receives a `group`
indistinguishable from a hand-written one. `<define>` and `<use>` are therefore not
`TagName`s; they are in `STRUCTURAL_TAGS`, which exists so a misspelled `<usse>` is answered
with `use`, and `isTag` still refuses both.

The expansion **splices** the component's children in place rather than wrapping them in a
group. A wrapper would be a node the hand-written twin does not have — one more `id`, one
more transform, one more level for `%` to resolve against — and the acceptance criterion is
that the two produce the same scene.

**An instance overrides with a class, propagated to every node of the expansion.**
`<use component="chip" class="second">` puts `second` on the group, on the rect inside it
and on the text beside that, so `.chip-bar.second { fill: #ffd166 }` reaches a node three
levels below the tag that wrote the class.

This is the same shape a flag adjustment already has. `{destaque}` in a brief is ambient
over an artwork — it is on every element — and a rule that wants it writes `.item.destaque`
beside the element's own class. An instance class is ambient over an expansion in exactly
that way, and an author who has read the adjustment rule has read this one.

The alternative is a descendant combinator: `.second .chip-bar`. ADR 0017 closed that door
on purpose, and this is precisely the pressure that would reopen it — which is why the
decision is recorded rather than implied. A combinator needs a second cascade to resolve
(which rule wins when two ancestors match?), and the language has no specificity: the last
declaration wins, full stop. Ambient classes need none of that. They compose by
concatenation, and the whole selector still reads left to right as a set of words the node
either carries or does not.

**A `<define>` may not write an `id`.** An id is unique across a frame, and a `<use>` may be
written twice; an id inside a component would collide with itself the second time. Positional
ids do not — `assignIds` derives them from the tree, so two copies get `…0.0` and `…1.0` on
their own — so the refusal costs only the one thing an explicit id buys, which is
`mask="#grad"`. A mask's target therefore stays outside the component, exactly where
`docs/template-authoring.md` already puts it for the `E_SCENE_MASK_DESCENDANT` reason.

**The vocabulary is `<define name="…">` and `<use component="…">`.** `<component>` for the
definition was rejected because the two halves would then be `<component>` and `<use
component>`, one word doing two jobs; `slot` for the instance was rejected outright, because
`slot` is the brief's word for the content a template draws and this language already spends
it on `<text slot="titulo">`. An `@component` at-rule was rejected because an at-rule block
holds style rules and a component holds markup.

**A diagnostic is reported once per range.** A component drawn three times is checked three
times — the instance classes differ, so the checks genuinely differ — and when all three
produce the same sentence at the same place they are one mistake, on one line of the
`<define>`, which is the line the author has to change. `compileTemplate` collapses them by
`(code, message, range)`.

**Component bodies are checked whether or not anything draws them.** A circular `<use>` or a
misspelled component name inside a `<define>` nobody has wired up yet is still a mistake, and
`tyto template check` is run on a template being written — where the `<define>` lands before
the `<use>` that will draw it.

## Consequences

A template author can write a block once. No built-in template does: this PR adds `<define>`
and `<use>` to the language and changes neither `promo-curso` nor `carrossel-lista`, because
neither contains anything to deduplicate. The first real consumer will be a template with
repeated cards, and if none arrives the honest reading is that the measurement above was
right and this entry was premature.

`<define>` and `<use>` take a closed set of attributes — `name` on one, `component` and
`class` on the other — which is what makes E4.10 (TYTO-75) a small change rather than a
redesign: `params="texto"` on the `<define>` and free-form bindings on the `<use>` are new
entries in the same two lists, and substitution lands in the same expansion, above
`checkSlot`.

A component cannot vary its content. Three `<use>` of one `<define>` draw three copies of
the same slots, which is a frame and not a filled frame; that is E4.10's whole subject, and
until it ships a component is worth writing only where the repetition is structural.

There is no shared component library and no CSS scoping. A component's classes are the
template's classes, in the template's one flat namespace — which is exactly why a library
across templates would need scoping, and exactly why it is not here.
