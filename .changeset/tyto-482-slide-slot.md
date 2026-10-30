---
'@tyto/core': minor
'@tyto/editor': minor
---

A slide carries its own slots (TYTO-482, ADR 0160). A manifest slot declared `per: lamina` takes one value per slide, written as `::imagem` after that slide's `::lamina`; it resolves like any other image, a missing file is reported at that line, and a template reads `slots.imagem` as this slide's picture. `ResolvedArtwork` gains `slots` and `missingRequiredSlots`, and a required `per` slot stamps only the slide that lacks it. The editor marks the slot `per lamina` and the skeleton writes it under every slide.
