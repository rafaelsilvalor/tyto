---
'@tyto/template-kit': minor
---

TYTO-825: `mainLineScale` answers the scale at which a title's `#` part fills its area's width
on one line, kept between `minScale` and `maxScale` (0.7 and 1.6 by default) and lowered until
the head fits the area's height when the caller says how tall it comes out (`heightAt`).
`blockColumn` fits a group taller than its area: every block is rebuilt smaller by one factor,
down to `shrinkFloor` (0.7), then the column grows above its top by up to `reach` (`rise`), and
what is still left over is `overflow`. Both pieces declare their numbers as parameters
(ADR 0224).
