---
'@tyto/template-kit': minor
---

`levelsOf` reads a block's lines as `docs/slot-vocabulary.md` ranks them: `|` between parts,
`#` to `###` for a part's level, the main part by position when a line has no mark, and a line
of `---` as the divider. `levelStack` draws them one part per row, each row as tall as its
measured words, with the level's look and the divider the template supplies.
