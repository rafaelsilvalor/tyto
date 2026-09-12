---
'@tyto/core': minor
'@tyto/pipeline': minor
'@tyto/io': major
'@tyto/export-svg': major
'@tyto/export-html': minor
---

Resources are resolved after `compile`, not before (E6.4).

`sceneResources(scene)` in `@tyto/core` says what a scene asks the outside world for: every
`AssetRef` it draws and every `SceneFontFace` its runs ask for, deduplicated, found through
the one `walk()` rather than through a second recursion. `JobPorts.loadResources` is handed
that list between `compile` and the first `exportFrame` — the only window where the question
has an answer and the answer is still useful — and may await. Jobs that use it emit a
`resources` stage event.

**The eager path is gone, not kept as a fallback.** `fileResources` no longer reads the
asset folder and is no longer async: it hands out resolvers over an empty store and a `load`
that fills it with exactly what the scene named. Keeping both alive would have meant two
ways for an asset to reach a document and no way to tell which one did. A caller that used
to `await fileResources(...)` now calls it plainly and passes `resources.load` to `runJob`
as `loadResources`. The template's own `src=` files are unaffected — `templateWiring` reads
that folder when it loads the template, which is already after the brief named it.

**`SvgFontFace` now carries `font: FontRef` instead of `family: string`.** It and
`HtmlFontFace` are both `SceneFontFace` from `core`, which is what lets one list serve both
exporters; the two used to describe a face differently, so the same scene produced two lists
that could not be compared. `FontRef` won because it says strictly more — a family alone
cannot tell a bundled face from one in the brief's folder, and a loader that has to open a
file needs the `path`. `face.family` becomes `face.font.family`. Both exporters also key
their face registries with `core`'s `fontFaceKey`, so a document deduplicates exactly as the
enumeration counts, and the SVG `@font-face` block is now sorted by that key rather than by
insertion order.
