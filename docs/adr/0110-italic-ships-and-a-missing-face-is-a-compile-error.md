# 0110 — Italic ships, and a face the font source cannot answer is a compile-time error

Status: accepted · 2026-10-21 · TYTO-329 · amends ADR 0021, beside ADR 0013, ADR 0025 and ADR 0037

## Context

`*text*` has been italic since the first grammar, and `@tyto/fonts` shipped Source Sans 3 at
Regular and Bold only. Italic was left out on purpose (`packages/fonts/README.md`, the
`BUNDLED` doc comment): the raster visual suite asked for it as "the face nobody ships", to
watch the exporter answer `E_EXPORT_FONT_UNRESOLVED`.

That made every italic in a brief over a bundled font a late failure. Measured by the TYTO-316
executor with the CLI (PR #112): `::titulo Open day at the *library*` compiled with no
diagnostic, and the export then stopped with `E_EXPORT_FONT_UNRESOLVED` and wrote no file. The
author learned it at the last step, and the user manual had to warn against italic and keep it
out of its examples.

Two things were missing: the faces, and a check that runs while the brief is written.
`compile` already had the port for the second. `CompileOptions.faces` is a `FaceCache` over the
`FontSource` the composition root supplies — the CLI, the window and `pipeline` each pass
`createFaceCache(fonts.source)` — and `faces.get(face) === undefined` is the answer that
becomes `E_EXPORT_FONT_UNRESOLVED` at export when the adapter answers both ports from one table.

## Decision

1. **Source Sans 3 Italic (400) and Bold Italic (700) are bundled.** From the same upstream
   release as Regular and Bold (3.052R, `adobe-fonts/source-sans`), the `.ttf` from the TTF
   archive and the `.woff2` from the WOFF2 archive's `TTF/` folder, upstream names and bytes,
   SHA-256 in `fonts/source-sans-3/LICENSE.md`. OFL 1.1, Reserved Font Name "Source": the files
   are not renamed or modified. About 790 KB more in every clone and install. This reverses
   "italic is absent on purpose"; the visual suite now asks for weight 300 as the face nobody
   ships, which keeps its intent.
2. **A face the font source cannot answer is `E_FONT_FACE_UNAVAILABLE`, raised by `compile`.**
   While laying out text, before the measurement that would skip the node, each run's face is
   asked of `faces`; an `undefined` reports the face (`{font}`, the label
   `E_EXPORT_FONT_UNRESOLVED` uses) and the template (`{template}`), with the range of the inline
   that produced the run — the italic words, not the whole directive. Once per face and range,
   across formats and artworks. `compileDeferred` gets it too, because it compiles through the
   same layout. Without `faces` nothing was asked, and nothing is reported.
3. **It is an error.** The export that follows is certain to fail on the same face, so the
   Problems panel, `tyto render`'s exit code and a CI run should go red before anybody
   exports, not after.
4. **It is not fatal** (ADR 0025). The frame is built, the preview draws, and the brief's other
   diagnostics still show: a missing face is about one artwork's export, not about whether
   anything can be drawn, and a fatal code would blank the preview over one italic word.

## Consequences

The manual's warning against italic is gone, in both editions; its inline-formatting example
uses italic, and its export and troubleshooting pages point at the new code.

The check is only as precise as the port. `FontSource` is asked by family, weight and style,
without `FontRef.source`, so two cases still surface only at export, as
`E_EXPORT_FONT_UNRESOLVED`:

- a `file` font, which the exporters refuse (`bundledFont`) and this port cannot tell apart;
- a family `@tyto/fonts` does not ship, named by a markup template (which makes every font
  `bundled`): the library answers its outlines with the machine's face or a substitute
  (ADR 0037), while the exporters substitute only for a `system` font.

What it does catch is a family the adapter ships at a face it does not — italic over Source Sans
3 before this ADR, and weight 300 after it. A substituted `system` italic is still drawn
upright, because the substitute rule predates the italic faces; that is a separate decision.
