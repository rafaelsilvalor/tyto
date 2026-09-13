---
'@tyto/pipeline': patch
---

An unresolved asset says so is a wiring mistake when the job was given no loader (TYTO-69).

`E_EXPORT_ASSET_UNRESOLVED` names the asset, which is the right answer when the file is
missing and the wrong place to look when nobody ever read it. An exporter cannot tell those
apart — its resolver answered `undefined` either way — but the job can, because it is the
stage that knows whether `loadResources` was supplied at all. So the diagnostic keeps its
code, its severity and its message, and gains a hint naming the port.

Assets only: a font resolver is bound ready-made (ADR 0021) and needs no loader, so pointing
an unresolved face at `loadResources` would name a seam that was never involved. A job that
was wired correctly sees exactly what it saw before.
