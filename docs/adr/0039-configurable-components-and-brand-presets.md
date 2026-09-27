# 0039 — A component is configured, a brand is a preset, and a template only composes

Status: accepted · 2026-09-27 · TYTO-185 · amends `docs/template-conventions.md`, leaves ADR 0022 alone

## Context

`docs/template-conventions.md` split a TypeScript template into three layers: tokens, parts
and arrangement. Only arrangement shipped as a package (`@tyto/template-kit`); tokens and
parts sat inside the template, and the conventions said a part moves to a shared module
**when the second template needs it, not in advance**. That rule came from ADR 0022, which
shipped a markup component mechanism ahead of its evidence and measured zero consumers five
days later.

On 2026-09-27 the maintainer brought the evidence the rule was waiting for, in advance of the
templates themselves: about **150 templates** are waiting to be ported, and **at least three
Saúde templates share one look**. His example was the Saúde approved list — a title, a
subtitle and pills of `rank | name` — which is the same structure as the agenda's
`date | title + professor` rows. He asked for components with some flexibility: one table that
can be configured into either, or into a plain table for another brand.

The agenda's parts could not be reused as they were. `parts.ts` imported its colours and
sizes from its own `tokens.ts`, and about fifteen sizes were literals inside the parts
themselves (the owl's 64, the date pill's 220 × 86, the paddings, the line heights), so a
second template could only copy the file.

## Decision

**Four layers, each with one home.**

| layer                   | holds                                                                                           | home                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| configurable component  | structure and behaviour; every colour, face and size arrives as configuration                   | `@tyto/template-kit`                              |
| brand tokens            | colours, face, type scale, spacing, marks' geometry                                             | `packages/templates/templates/_<brand>/tokens.ts` |
| brand presets and parts | a component in the brand's look (`sessionTable`); pieces only that brand draws (its owl header) | `_<brand>/presets.ts`, `_<brand>/parts.ts`        |
| template                | composition: which pieces, in what order, where                                                 | `<template>/template.ts`                          |

**A component holds no brand.** `pillTable` is the first: one line of a slot is one row, `|`
separates its cells, an optional line with no `|` heads a group, and a `PillTableStyle` says
everything about how it looks — columns (a badge holding one field, or a cell of stacked lines
that grow with measured text), pills or no shapes, overlapping or side by side, gaps and
minimum heights, group headings. Configuring it is data, not code: the Saúde session table and
the Saúde approved list are two constants in one preset file.

**The kit hosts components, not only arrangement.** A component is the same whatever brand
draws it, which is the test the kit's boundary already used for `stack`; a table configured
entirely from outside passes it. A separate package was weighed and refused: it would split
one import into two for templates, add a package to the labeler and the release, and draw a
line between "arranges" and "draws" that no consumer needs yet.

**A brand is a folder with no manifest.** `_estrategia-saude/` sits beside the templates that
use it. The registry reads one `manifest.yaml` per subfolder and skips a folder without one in
silence (`packages/core/src/template/registry.ts`), so the brand needs no change to discovery;
the leading underscore is for the reader, not for the code.

**Numbers are tokens.** `parts.ts` and `template.ts` may halve, double and centre; any other
numeric literal there is refused by ESLint (`templates/numbers-are-tokens`). Presets reference
tokens by name, so `tokens.ts` is the spec sheet of the brand.

**Names say what drew them.** Every node a part or a component draws has a name, in English
kebab-case, after the piece that drew it (`session-pill`, `owl`). Slot names stay the brief's
Portuguese vocabulary (`docs/template-authoring.md`).

**The second-consumer rule is overridden for components**, not repealed for everything. The
declared backlog is the consumer: a component is extracted when the maintainer names the
templates that will use it, as he did for the table. A part nobody has named a second use for
still stays in its template.

## Consequences

`agenda-semana` is composition over the Saúde module: `header()`,
`titleBlock(coverTitle)`, `pillTable(sessionTable)` and `footer()`, placed by `bandedPage`.
Rewritten onto the components it renders **the same pixels** as before — 0 of 1,458,000
different on each of the example brief's two slides, against `main`, with a one-pixel token
change producing 27,367 and 28,885 as the control. The one deliberate change is the footer
arrow, which announces a next slide and is therefore not drawn on the last one.

**The second template cost no drawing code.** `aprovados`, the Saúde approved list, was built
in the same PR from the maintainer's annotated reference: `titleBlock(resultTitle)` and
`pillTable(approvedTable)` on the same `bandedPage`, with a new preset and tokens and nothing
else. Matched in the live preview, every glyph run inside its slide lands within 2 px of the
reference. The maintainer's annotation named the pieces — top, title, areas, footer, margins
and gaps — and each is one call; the margins and gaps, which he saw repeated but did not
expect to be a component, became `bandedPage` and the brand's tokens.

ADR 0022 is untouched. The markup route keeps its per-template components and its refusal of
a shared library, for the reason it gave — one flat class namespace per template — which does
not apply to a function.

The cost is paid by the kit's interface. A configuration surface that grows by one option
per template becomes a second language; `pillTable` and `titleBlock` take what the agenda
and the approved list need and nothing either lacks — the approved list added a `rewrite` for
`1º` → `1º Lugar` and unequal top and bottom padding, both used — and the next component waits
for the references the maintainer groups by idea.
