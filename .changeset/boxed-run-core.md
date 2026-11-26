---
'@tyto/core': minor
---

A text run may carry a box (ADR 0231, TYTO-900): `TextSpan.box` holds a solid paint, padding measured from the capitals (`x`, `over`, `under`), an optional radius and the face's metrics. `compile` writes the metrics from the run's face, `Face` gains `capHeight`, line breaking counts the box's side padding, and `RunStyle`/`run()` take a box so a highlight can name one. A scene with no box is unchanged.
