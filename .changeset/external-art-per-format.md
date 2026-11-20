---
'@tyto/core': minor
---

An external art slot may have a file per format beside the one the brief cites (ADR 0222):
for `grafico.png`, `grafico.story.png` is what the story draws, and a format with no such file
draws the cited one. Only external slots are looked for, one more read of the asset port per
rendered format. `W_EXTERNAL_ART_MISSING` names the formats still drawn as a box, and is silent
when every format has its file. `externalArtVariant` gives a copy's reference.
