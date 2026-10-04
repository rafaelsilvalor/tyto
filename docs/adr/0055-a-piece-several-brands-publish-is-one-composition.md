# 0055 — A piece several brands publish is one composition, and the house owns what its brands share

Status: accepted · 2026-09-28 · TYTO-200 · extends ADR 0047, leaves ADR 0052 alone

## Context

ADR 0047 gave every brand a folder, `_<brand>/`, with its tokens, presets and parts, and gave
every template one job: composition, in its own `template.ts`. It was written with one brand in
view — the azul brand — and two templates that each drew a different piece.

On 2026-09-28 the maintainer brought the weekly mock-exam agenda ("Simulados da semana"), the
first piece published by **several brands at once**: roxo, ocre and
vinho draw it identically but for an accent colour and a sign-off, and roxo publishes it in
no grid. Two facts in it had no home under ADR 0047:

- **The composition is the same three times.** Three `template.ts` files would each hold the
  same forty lines, and a fix to one would be a fix to remember twice more.
- **The owl belongs to the house, not to azul.** It was azul's geometry in `_azul/`,
  and the three new brands draw the same owl in their own colour.

A single template with a brand slot was weighed and refused with the maintainer: the manifest
would stop saying whose look it draws (ADR 0052), and "roxo has no grid" would become code
in the template instead of a `formats` list the pipeline already refuses against.

## Decision

**One template per brand, one composition for all of them.** Each brand gets its own template —
`simulados-semana-roxo`, `-ocre`, `-vinho` — with its own manifest, `brand` and `formats`, so the
picker, the registry and the formats check read each as a separate contract. Their `template.ts`
is one line: the shared composition applied to the brand.

**The shared composition lives in the house's folder, as `compose.ts`**, and ESLint holds it to
the rule a `template.ts` is held to (`templates/numbers-are-tokens`): every number is a token.

**A house folder, `_casa/`, holds what the house's brands share**: the marks (the owl, the
speech balloon), the tokens the three agenda brands have in common, their brands' accents and
sign-offs in `brands.ts`, and the composition. A brand-specific folder such as
`_azul/` imports from it; azul's tokens now re-export the owl rather than define it,
and azul's scene is unchanged.

**What differs between brands is data** — a `Brand` value holding the accent and the sign-off —
passed to presets and parts as an argument, so a preset that varies by brand is a function of
the brand (`examTable(accent)`) instead of one constant per brand.

## Consequences

Adding a fourth brand to the agenda is a manifest, a one-line `template.ts`, a `Brand` in
`brands.ts` and an example brief; no drawing code.

The kit grew one option for this piece: `pillTable`'s group **caption**, the band under a day
heading, read from the heading line's second field. With a caption, a heading is the line with
one separator and a row the line with none, which is how a table of one-field rows tells the
two apart.

The piece's slides are cut by hand in the brief, one `::lamina` per slide, and **one slide feeds
both formats**: a slide written for the story can be too tall for the grid, and a template
cannot yet report that — its build returns a frame and no diagnostics. The example briefs are cut
to fit the grid; a warning, or letting a template decide its own slide count, is a card of its
own.
