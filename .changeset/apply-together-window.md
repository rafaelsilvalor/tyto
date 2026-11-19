---
'@tyto/io': patch
'@tyto/desktop': minor
---

The notebook draws **Apply all plans** under a recipe's `apply together` header line (TYTO-758,
ADR 0219), over the new `recipe:apply-together` channel, with a long write's progress and
Cancel under it and where it stopped once it ends. Under that header no plan has an Apply of
its own, so a lower plan is never applied before the ones above it. `applyTogether` tells its
caller each cell it starts (`onCell`), so the window shows progress on the cell being applied.
