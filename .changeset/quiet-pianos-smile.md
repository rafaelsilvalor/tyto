---
'@tyto/brief-lang': minor
'@tyto/core': minor
---

A directive is ranged twice: the whole of it, and its name (E3.4).

`Directive` gains `nameRange`, a span over the name alone. It takes in the namespace and
its slash — `::ai/caption` underlines `ai/caption` — and leaves out the `::`, which is the
only way to write a directive and therefore never the part that is wrong.

`resolve` reports `E_UNKNOWN_SLOT` and `E_UNKNOWN_DIRECTIVE` against it. A misspelled name
on a directive with a three-line body used to underline all four lines, because `range` was
the only span there was. Every other diagnostic keeps the range it had: they are about the
value, and the value is the body.

A frontmatter key is already its own name, so that half of `E_UNKNOWN_SLOT` needed nothing.
