---
'@tyto/template-kit': minor
---

`card` draws an outlined box cut into segments from top to bottom, any of them a filled band
that takes the corners of the edge it reaches; it grows to its segments, or keeps a fixed
height and reports the overflow. `cardRow` draws cards side by side at one height, their first
bands lined up and each one's room before its foot. `cardSegments` reads an `::apelo`'s levels
as a title, a band and a foot; `bandBottom` gives the edge a caller pins so a growing band
rises (TYTO-800).
