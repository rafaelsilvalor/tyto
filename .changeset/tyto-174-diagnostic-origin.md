---
'@tyto/cli': patch
---

TYTO-174 — `tyto render` places a markup template's diagnostics in `template.html` again. The
brief's origin was registered over the one `templateWiring` had already recorded, so a
broken tag on line 15 of the template printed as `promo.brief:15:1`: a real line of a file
with nothing wrong in it. The first registration now wins, which is what the comment beside
the second one always said.
