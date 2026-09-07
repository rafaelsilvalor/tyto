---
'@tyto/core': minor
---

Make a line break a run in the Scene IR (ADR 0016).

`TextRun` is now a discriminated union: `TextSpan { kind: 'text', … }` or
`LineBreak { kind: 'break' }`. A break is a member of the run list rather than a `\n`
inside a span's text, so no exporter has to scan a string to find one — the same rule that
keeps colour structured. `compile` (E4.2) now has somewhere to put the `Break` inline that
`parseBrief` produces for a trailing `\` and for a block line boundary.

Leading, trailing and consecutive breaks are legal; a `LineBreak` carries no styling.
`E_SCENE_EMPTY_TEXT` widens from "no runs" to "nothing to draw", so a text node whose runs
are all breaks is now caught by the invariant that already caught an empty one.

The template SDK gains `lineBreak()` beside `run()`, and `run()` returns a tagged
`TextSpan`.
