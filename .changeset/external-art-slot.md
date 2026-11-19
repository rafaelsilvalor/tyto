---
'@tyto/core': minor
'@tyto/templates': minor
---

An image slot may declare `external` art, painted in another program at a size per format
(ADR 0220). Until its file exists the brief still renders: `W_EXTERNAL_ART_MISSING`, and an
outlined box where the art goes. `full` art that does not keep a format's proportion is
`E_EXTERNAL_ART_ASPECT`. The pack ships `arte-teste`, a test template with one of each kind.
