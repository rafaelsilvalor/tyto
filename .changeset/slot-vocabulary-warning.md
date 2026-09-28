---
'@tyto/core': minor
'@tyto/cli': minor
'@tyto/template-lang': minor
---

`tyto template check` warns with `W_SLOT_VOCABULARY` when a manifest names a slot against the
standard vocabulary in `docs/slot-vocabulary.md`: a known synonym (`emblema` for `imagem`,
`slide` for `lamina`, `cor` for `tom`…), a reserved name with the wrong shape, or a repeatable
slot not named `lamina`. It is a warning and never fatal, and a name the document does not list
is never flagged. `checkSlotVocabulary` is exported from `@tyto/core`.

The template scaffold (`tyto template new`, the desktop's New template, `tyto plugin new`)
names its look-variant slot `tom` instead of `cor`, so a new template starts without the
warning. A scaffolded brief writes `tom: laranja`.
