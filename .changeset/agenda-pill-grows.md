---
'@tyto/templates': minor
---

TYTO-184: in `agenda-semana`, a session title or professor too long for one line wraps onto the next
and the pill grows to hold it, as the published artwork does, instead of shrinking. The date pill
grows with it, and the sessions below move down. A title that fits keeps the published 86 px pill.
Where nothing can measure the text, the pill keeps its single-line height and a long line shrinks,
as before.
