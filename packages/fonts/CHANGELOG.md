# @tyto/fonts

## 0.4.0

### Minor Changes

- aac15e5: TYTO-269: the package now ships IBM Plex Mono, Regular and Bold (`@ibm/plex-mono@2.5.0`, OFL 1.1), for the desktop editor. It is deliberately not registered as a render face, so no scene can name it and nothing an export embeds changes.
- 53e01c3: TYTO-280: a plugin can supply images and fonts (ADR 0117). `@tyto/plugin-api` has two new extension points, `asset-source` (URI schemes such as `drive:`) and `font-source` (families), each with a `fetch` an installed plugin answers from its own process; the call carries the plugin's own section of the project file, absent when the folder withheld it. `@tyto/io`'s `sourceCache` asks them once and keeps the answer in `TYTO_HOME/cache/sources/<plugin>/`, named by a hash, so the next render asks nothing; a restricted folder reads the cache and fetches nothing. `@tyto/core`'s `AssetResolver` gains an optional `explain`, and a source's failure is `E_ASSET_SOURCE_FAILED` or `W_FONT_SOURCE_FAILED`. `@tyto/fonts`' library gains `refresh()`, and `@tyto/pipeline`'s `loadResources` may ask for one more compile once a fetched face arrives.
- 8e9c9c4: TYTO-329: `*italic*` exports. `@tyto/fonts` ships Source Sans 3 Italic (400) and Bold Italic (700) from the same 3.052R release as Regular and Bold, so a brief with italic over a built-in template no longer compiles cleanly and then stops at export with `E_EXPORT_FONT_UNRESOLVED`. A face the font source still cannot answer is now reported by `compile` as `E_FONT_FACE_UNAVAILABLE`, an error that is not fatal, on the text that asks for it, so the Problems panel and `tyto render` say so before the export (ADR 0110). The raster visual suite asks for weight 300 where it asked for italic as the face nobody ships; the user manual drops its warning against italic in both editions.

## 0.3.0

### Minor Changes

- d4aac5b: TYTO-189: an installed plugin can ship code templates, and they run in its own thread. A folder
  in an installed pack with a `manifest.yaml` and no `template.html` is drawn by the pack's new
  `build(template, context)`, called through the isolation with the 30 s deadline. The frame is
  checked against the IR, and a timeout, throw or refused answer is `E_PLUGIN_TEMPLATE`, which
  costs that frame and not the render. `context.measure` still answers synchronously. The manifest
  lists the faces it measures under `faces:`, and those cross with the call. A face installed on
  the machine crosses only under the `font:<family>` permission (`W_PLUGIN_FONT_WITHHELD` otherwise).
  `tyto plugin new --code` scaffolds one that installs and renders on the first try. `compile` is
  unchanged for every other template, and `compileDeferred` is the new path (ADR 0048).

## 0.2.0

### Minor Changes

- b587f0d: TYTO-182: a face can come from the machine that renders, and a missing one is drawn and reported
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

## 0.1.0

### Minor Changes

- 9988e5d: The fonts Tyto ships become a package, so a render can reach them (ADR 0021).

  `@tyto/fonts` holds `fonts/<family>/` and the reader that hands the bytes to the exporters'
  `font` port as a `data:` URI and to `FontSource` as outlines. The faces used to sit at the
  repository root, where a package's `files` cannot reach, so no install ever had them and
  `tyto render` answered `E_EXPORT_FONT_UNRESOLVED` for every built-in template. `apps/cli`
  binds the resolver; `tools/test-fonts` is gone, promoted into this package.

  A `FontRef { source: 'file' }` is refused rather than matched by family name — a brief that
  points at its own font file must not be handed a bundled build of the same design.

  `@tyto/io`: `fileResources`' doc comment was describing a repository that bundled no font.
  No behaviour change.
