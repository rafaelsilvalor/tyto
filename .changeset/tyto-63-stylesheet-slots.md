---
'@tyto/template-lang': minor
---

TYTO-63 — a slot used only in the stylesheet is not unused.

`compileTemplate` collected `renderedSlots` from the markup alone: `slot="…"` attributes and
`{x}` spliced into a `src`. A template that decides its background with
`@if slot(cor) is laranja { :root { --bg: #ff5900 } }` therefore reported `cor` as drawn by
nothing, and a brief that set it got `W_UNUSED_SLOT` — the warning telling the author to
delete the line that makes the template work.

`renderedSlots` is now every slot the template **reads**, from four sources: a `slot`
attribute, a slot spliced into a `src`, an at-rule condition (`@if … is <value>`,
`@if … is empty`, `@each <slot>`), and the seeded variable `var(--slot-x)` however deeply a
call nests it. The last one is past the letter of the card, which named the at-rules; it is
the same bug wearing a different spelling, and the card's own reason for checking all three
at-rules — _fixing one of three is a bug report waiting to be written again_ — applies to it
unchanged.

Deliberately still unused: a conditional block with nothing inside it. `@if slot(cor) is
laranja { }` reaches the cascade with no declarations and changes no output, so the slot in
its prelude really is used by nothing.

The warning is unchanged for a slot the template mentions nowhere, which is the half a fix
like this can quietly trade away.
