---
'@tyto/desktop': minor
'@tyto/editor': minor
---

TYTO-402, ADR 0176: New recipe and New vocabulary, in the explorer's menu and as commands, write
`recipeSkeleton` and `vocabularySkeleton` into a new `<name>.recipe` or `<name>.vocab.json`, and
never over a file already there; a recipe name a `run` line could not name is refused with
`E_RECIPE_FORM`. A `*.vocab.json` opens in a vocabulary tab of its own, in JSON's colours, and no
other `.json` does. Main checks it on the pause with `lintVocabulary`, every problem at its
characters in the file, and answers its completion and hover on the new `vocabulary:lint`,
`vocabulary:complete` and `vocabulary:hover` channels. `jsonAssist` in `@tyto/editor` takes a
source whose answers arrive later (`JsonAssistSourceLater`).
