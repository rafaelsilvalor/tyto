---
'@tyto/editor': minor
---

TYTO-419 (ADR 0143 amendment): `@tyto/editor` ships three more vim operations for a
contribution to map, with no keys mapped yet (the desktop's built-in plugin maps them in a
later change). `replaceWithRegister` is a `gr` operator that replaces the text a motion covers
with a register and leaves the registers as they were. `exchange` is an operator with two
motions after an operator: `x` turns `c` into exchange (`cx{motion}` twice swaps two spans,
`cxx` is a line) and `c` clears the marked span (`cxc`) while `cc` still changes the line.
`unimpaired.blank` and `unimpaired.move` add blank lines above or below and move the line up
or down by a count, in one undo step.
