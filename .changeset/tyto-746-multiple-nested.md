---
'@tyto/core': minor
'@tyto/brief-lang': patch
'@tyto/editor': patch
'@tyto/plugin-api': patch
---

Several values of a nested slot in one parent (TYTO-746, ADR 0207 note of 2026-11-16).
`multiple: true` may now be declared on any `per` slot, at any depth: with
`bloco: { per: lamina, multiple: true }`, every `::bloco` in the same slide is a value of its
own, with its own body and nested slots, in brief order. A template still reads
`context.slots.bloco` as the first one, and iterates every one through its new optional
`occurrences` (`slot.occurrences ?? [slot]`). A manifest that declares no `multiple` resolves
to exactly what it did. An image slot `per` the repeatable slot keeps ADR 0160's pictures among
a slide's lines.

`@tyto/core`: on a `multiple` slot `max` counts occurrences per parent, and one past it is
`E_BAD_SLOT_VALUE` at its own line; `min` on a `multiple` slot, and `multiple` without `per`,
are manifest errors. `listsOccurrences` is exported.

`@tyto/brief-lang`, `@tyto/editor`, `@tyto/plugin-api`: tests only — a fixture with two blocks
per slide and two paragraphs per block, the block list, breadcrumb, Go to Block and fold over
siblings, and `occurrences` crossing to an isolated template.
