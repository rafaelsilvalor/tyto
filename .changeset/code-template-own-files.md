---
'@tyto/core': minor
'@tyto/template-lang': patch
'@tyto/pipeline': minor
'@tyto/io': patch
'@tyto/plugin-api': patch
---

TYTO-214: a code template reads the files in its own folder through `context.files.image(path)`
and `context.files.svg(path)` (ADR 0062). `TemplateContext` gains the required `files` field, and
a context built by hand passes `noFiles`. `bundledTemplateSource` takes an optional
`readFiles(directory)`; without it, a bundled template is handed no files, as before. An
installed plugin's code template is handed `noFiles`.
