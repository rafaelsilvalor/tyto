---
'@tyto/template-kit': patch
---

`levelsOf` keeps a `\` the author typed inside its part, drawn as a line break there, instead of
starting a new level line; the spaces against it and a break at either end of a part are taken
off. `cardSegments` reads through it, so a card's band, title and foot break the same way.
