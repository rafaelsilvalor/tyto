---
'@tyto/fonts': minor
'@tyto/io': patch
---

The fonts Tyto ships become a package, so a render can reach them (ADR 0021).

`@tyto/fonts` holds `fonts/<family>/` and the reader that hands the bytes to the exporters'
`font` port as a `data:` URI and to `FontSource` as outlines. The faces used to sit at the
repository root, where a package's `files` cannot reach, so no install ever had them and
`tyto render` answered `E_EXPORT_FONT_UNRESOLVED` for every built-in template. `apps/cli`
binds the resolver; `tools/test-fonts` is gone, promoted into this package.

A `FontRef { source: 'file' }` is refused rather than matched by family name — a brief that
points at its own font file must not be handed a bundled build of the same design.

`@tyto/io`: `fileResources`' doc comment was describing a repository that bundled no font.
No behaviour change.
