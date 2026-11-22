---
'@tyto/template-kit': minor
---

TYTO-834: `levelsOf` reads `#` to `######` (levels 1 to 6, `DEEPEST_LEVEL` 6); seven or more,
or a mark glued to its word, stay words. `bodyBlock` takes sizes for `####` to `######` when a
template gives them, draws a deeper level it gives none at the nearest level above, and sizes an
unmarked line by the smallest marked level the block uses. `peso` takes `1` to `5` with `3` the
block as designed (0.7, 0.85, 1, 1.2, 1.4; `weight1` to `weight5` in `BLOCK_COLUMN_PARAMETERS`,
which replace `lightWeight`, `normalWeight` and `heavyWeight`). A brief written with the three
weights changes: `{peso: 1}` was 0.85 and is now 0.7, `{peso: 3}` was 1.2 and is now the
designed size.
