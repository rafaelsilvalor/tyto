# @tyto/fonts

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
