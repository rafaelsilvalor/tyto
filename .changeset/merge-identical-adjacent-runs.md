---
'@tyto/core': patch
---

Adjacent runs that would draw the same thing are one run (TYTO-72).

`runsOf` emitted one `TextRun` per `text` inline and never looked back at what it had just
pushed. The split that produced is not `a **b** c` — that is three inlines with two styles
and correctly stays three runs. It is a mark the template never declared: `styled` passes
those children through with the surrounding style _exactly_, so `Turma {cor:roxo}nova{/} de
setembro` in a template with no `.cor-roxo` became three runs that draw identically. An
editor opening the SVG found three text boxes edge to edge where there should be one.

The runs now merge when `font`, `size`, `weight`, `style`, `color` and `decoration` all
match. A `LineBreak` is never a merge target, so leading, trailing and consecutive breaks
are untouched (ADR 0016).

The merged run's origin is the union of both sources, which is the decision this needed
rather than a detail: `W_TEXT_OVERFLOW` finds a slot by asking which one _contains_ a run's
origin, so the union stays inside the directive and the warning still points at the whole
answer the author gave.

The artwork is unchanged. Measured on `promo-curso` at feed size, the sentence above goes
from four spans to two — the two that remain are the line the layout wrapped.
