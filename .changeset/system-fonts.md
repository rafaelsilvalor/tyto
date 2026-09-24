---
'@tyto/core': minor
'@tyto/fonts': minor
'@tyto/pipeline': minor
'@tyto/templates': minor
'@tyto/cli': minor
'@tyto/desktop': minor
---

TYTO-182: a face can come from the machine that renders, and a missing one is drawn and reported
(ADR 0037).

`FontRef.source` gains `'system'`, asked for with `systemFont(family)`. `@tyto/fonts`'
`createFontLibrary({ describe: describeFace })` reads the platform's font folders, matches a file
on its own tables, and answers the exporters and measurement from the same file. Where the machine
lacks the face it draws the bundled Source Sans 3 at the nearest weight and raises
`W_FONT_SUBSTITUTED`, in `result.json` and in the desktop preview.

`agenda-semana` now draws in CircularXX: Black for the cover, Medium for the discipline, date and
session title, Light for the professor and the handle.

`JobPorts.loadResources` may answer with diagnostics. `sceneResources` no longer lists a declared
font at 400 when its runs already draw it. The desktop export now measures text, as the CLI and
the preview do.
