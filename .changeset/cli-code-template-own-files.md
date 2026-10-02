---
'@tyto/cli': patch
'@tyto/io': patch
---

TYTO-214: `tyto render` and `tyto watch` hand a bundled code template the files in its own folder,
through `context.files` (ADR 0062). Before, a code template could not draw a background kept beside
its manifest. `fileTemplateAssets`
now types its `assets` as `TemplateFiles`, which it always was.
