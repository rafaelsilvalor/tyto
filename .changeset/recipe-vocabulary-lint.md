---
'@tyto/recipe': minor
'@tyto/core': minor
---

TYTO-402, ADR 0176 decision 5: `lintVocabulary` checks a `*.vocab.json` where it is written, its
rules, rewrites and lookups by their verbs' schemas and its filters, patterns, templates and
replacements at the file's characters, mapped through the JSON string escapes;
`vocabularySkeleton` writes one that lints clean. `@tyto/recipe` depends on `jsonc-parser`, the
reader `@tyto/io` uses for data files. `@tyto/core` gains `E_VOCABULARY_SYNTAX` and
`E_VOCABULARY_SHAPE`.
