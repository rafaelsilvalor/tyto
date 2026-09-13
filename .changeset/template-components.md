---
'@tyto/template-lang': minor
---

Reusable components in the template markup: `<define>` and `<use>` (TYTO-74).

A block written once and drawn where it is named. `<define name="chip">` sits at the top
level beside the frames, in any order; `<use component="chip">` goes wherever a node may
appear, including inside another `<define>`. Expansion happens on the parsed document
before `collectFrames` reads it, so nothing downstream learns the two tags exist: the
document that leaves `expandComponents` holds the tags the author would have typed by hand,
and the IR receives a `group` indistinguishable from a hand-written one.

The classes on a `<use>` land on **every** node of the expansion, however deep, which is how
an instance is overridden in a language with no descendant combinator and no specificity —
`.chip-bar.second` reads a class written three levels above it. It is the shape a flag
adjustment already has over an artwork (`.item.destaque`). ADR 0022 records why, and why the
combinator ADR 0017 closed stays closed.

A `<define>` writes no `id`: an id is unique in a frame and a `<use>` may be written twice.
A circular `<use>`, an unknown component name (with a suggestion), a second `<define>` under
one name, an empty `<define>`, a `<define>` written anywhere but the top level and a `<use>`
written at it are each refused with a range. A component nothing draws yet is checked
anyway, because `tyto template check` is run while a template is being written.

Diagnostics are now reported once per `(code, message, range)`. A component drawn three
times is checked three times and the same sentence at the same place is one mistake, on one
line of the `<define>`.

No built-in template changes. Across `promo-curso` and `carrossel-lista` there are 10
drawable tags and 0 repeated subtrees; the duplication those two files contain is in the
stylesheet, which a component does not touch.
