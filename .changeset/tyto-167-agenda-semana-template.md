---
'@tyto/templates': minor
---

TYTO-167 — the first production template written in TypeScript, and the first entry in
`BUILT_IN_TEMPLATE_BUILDS`, which TYTO-166 shipped empty. `agenda-semana` draws the Estratégia
week's agenda as a carousel: a cover on the first slide, one discipline per slide, and as many
session rows as the brief wrote.

**It was picked as a hard case.** 27 drawable nodes in a slide against an 8-tag high-water mark
in the markup pack, and 20 of the 27 are four copies of one five-node row. Three open cards are
routed around rather than closed: stacking is `stack()` and not TYTO-161, repetition is `.map()`
and not TYTO-163, and "first slide only" is `context.artwork.index === 0` and not TYTO-164. All
three stay real for the markup route.

**The three layers held, and a `Block` bought more than stacking.** `template.ts` is composition
and nothing else; the numbers are in `tokens.ts` and the shapes in `parts.ts`. The unplanned win
is that a block carrying its own height lets the template _place itself_: the body is centred in
the room between the owl and the handle, computed from the stack's measured height, so a slide
with one session and a slide with four are both balanced. A markup group has no size to read
back, so that layout is not available on the other route at all.

**Both numbers come from the brief, and one of them costs a convention.** A manifest may declare
one repeatable slot and its occurrences become artworks, so the repeat is spent on "a slide per
discipline" and the rows inside a slide have nothing left to repeat with. The sessions are read
out of the occurrence's own lines instead — first line the discipline, each line after it
`date | title | professor`. It works today and it asks a brief's author to learn a separator the
language does not enforce; the split refuses to cut inside `**bold**` or a mark, where a bar is
somebody meaning something else.

**The wall is made to announce itself.** The grey pill's height is fixed, because a template
cannot measure text: `build` decides every coordinate before `layoutText` runs. The choice this
template makes is to state the text box's `h` as well as its `w`, so a title too long for the
pill is a `W_TEXT_OVERFLOW` naming the `disciplina` directive — instead of an absent `h`, which
means "as large as the content needs" and wraps the title silently out of the shape around it.
TYTO-162 removes the wall; until then the only fix is a shorter title, and the author is told.

And there is no second guard: `max` counts **occurrences** on a repeatable slot, not characters,
so the manifest can cap how many slides a week has and cannot cap one line inside a slide.

**A wrong render that no test caught, found by looking at one.** A path vector's `size` is its
viewport — `export-html` writes it as the `viewBox` — so it has to be the box the `d` was drawn
in, with the appearing size coming from `transform: { scaleX, scaleY }`. Passing the drawn size
clips the geometry to a fraction of itself in both exporters with no diagnostic anywhere. It is
now a paragraph in `docs/template-conventions.md` and two assertions.

**Measured.** 20 tests in `@tyto/templates` and 37 in `@tyto/contract-test`, the latter with the
bundled faces so the overflow claims are about text that was actually measured. Three
perturbations, to prove the suites hold the three promises: dropping the stated box height
reddened **1 of 37** and nothing in the unit suite, drawing the cover on every slide reddened
**2 of 20**, and sizing a mark at its drawn size reddened **2 of 20**. `pnpm check`: 70 of 70
tasks, 0 cached.

**Two things the assets are not.** The owl and the arrow are geometry written for this card, not
lifted from the brand files, which are not in this repository — swapping them in is changing `d`
and `box` on two constants, and no call site names a coordinate. The calendar illustration is an
optional `image` slot the example brief does not fill, so the cover ships with its words and no
picture.

`tyto template check` still reads `manifest.yaml` and `template.html`, so it reports a read
failure for this folder and the pack's acceptance test routes around it. TYTO-170.
