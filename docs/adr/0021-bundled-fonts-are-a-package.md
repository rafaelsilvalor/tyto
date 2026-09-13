# 0021 — The bundled fonts are a package, and the reader ships with them

Status: accepted · 2026-09-13 · applies ADR 0010 to E4.5, and reads ADR 0020 the other way

## Context

Design directive 4 says _same brief + templates + fonts ⇒ same bytes; fonts are
bundled/pinned, never `system-ui`_. TYTO-61 delivered the first half: `fonts/source-sans-3`
at the repository root, two faces from one upstream release with a licence and a SHA-256
beside them. The second half never arrived, and the gap was measurable — from a project
holding only `promo.brief` and a `formats.yaml`:

```
promo.brief: error E_EXPORT_FONT_UNRESOLVED Font 'Source Sans 3 400 normal' was not resolved to embeddable bytes; …
promo.brief: error E_EXPORT_FONT_UNRESOLVED Font 'Source Sans 3 700 normal' was not resolved to embeddable bytes; …
promo.brief: error E_EXPORT_FONT_UNRESOLVED Font 'Source Sans 3 400 normal' was not resolved to embeddable bytes; …
promo.brief: error E_EXPORT_FONT_UNRESOLVED Font 'Source Sans 3 700 normal' was not resolved to embeddable bytes; …
```

Four per run, one per face per frame, exit 1, no artifact. Both built-in templates draw in
`Source Sans 3`, so neither could be exported at all. Identical with `--templates` pointed
at the pack, so it was never about how the pack is found.

The reader existed. `tools/test-fonts` read those bytes and handed them out as `data:` URIs
synchronously, which is the only shape `HtmlResources.font` accepts — `raster`'s visual
suite has embedded real glyphs through it since TYTO-61. It was `private`, under `tools/`,
and said why in its own doc comment:

> it exists to make tests render real glyphs, and a published package that reads a path
> relative to the repository root would be a bug waiting for its first consumer.

That sentence is the whole problem, and it is not about taste. A package's `files` cannot
reach above its own directory, so **fonts at the repository root are fonts no install ever
sees**, and a reader that finds them by walking up to `pnpm-workspace.yaml` finds nothing
inside `node_modules`. Pointing `apps/cli` at it would have shipped exactly the bug the
comment names.

So the question was never "which function do we call". It was where the bytes live relative
to an installed package, and what the OFL requires of a redistributed copy.

## Decision

### The bytes move into a package, because that is the only place `files` can reach

`packages/fonts` — `@tyto/fonts` — holds `fonts/<family>/` and lists it in `files`. The
folder is unchanged: same names, same bytes, same `LICENSE.md` inside it rather than beside
it, which is what keeps the licence travelling with the faces when the package is
installed. OFL 1.1 permits the redistribution; what it asks for is the licence alongside and
the reserved font name left alone, and nothing here renames or modifies a face.

`fonts/README.md` argued for the root on the grounds that four packages want the same bytes
and none of them owns them, so a `__fixtures__` folder inside any one would make the other
three reach across a boundary. That argument was right and is not contradicted: a package
whose only subject is the fonts owns them without being any of the four. The README moves
with the folder and now says so.

### It is a Node package, where `@tyto/templates` is a pure one

ADR 0020 kept `@tyto/templates` pure and made the composition root resolve its directory,
rejecting "make it a Node package so it can resolve its own folder" as _a hole in the rule
that makes the cloud possible later_. This ADR does the opposite thing for the fonts, and
the difference is what each package's contents are for.

A template pack is **data a pure stage compiles**. `resolve` and `compile` read a manifest
and markup, so the package that holds them has to load in a browser and in a cloud worker;
only _locating_ the folder needs a runtime, and ADR 0010 puts that in exactly one place.

Font bytes are never read by a pure stage. `FontSource` in `core` and `resources.font` on
the exporters are **ports**, declared precisely so that the pure side can ask for bytes it
is not allowed to open, and whatever answers a port is an adapter. `@tyto/fonts` is that
adapter. ADR 0010 puts adapters beside their runtime — `raster`, `io`, and now `fonts` —
and the boundary lint lists it with them.

Given that, the reader ships beside the bytes it reads rather than in a third place. It
locates them with `../fonts` from `import.meta.url`, which is the same depth from
`src/index.ts` and from the `dist/index.js` tsup writes, and which is right in a workspace,
in a published install, and inside an Electron `asar` where Electron patches `fs`.

**One reader, not one per consumer**, and that decided where it goes as much as the
argument above did. The alternative was a pure `@tyto/fonts` holding the face table with the
reading done in `@tyto/io`, mirroring ADR 0020 exactly. It fails on a fact about the
dependency graph rather than on principle: `io` already devDepends on `raster`, and
`raster`'s visual suite is one of the two things that needs the reader, so `raster` would
have to depend on `io` and Turbo would be handed a cycle. Duplicating the twenty lines
instead — one reader for the product and one for the tests — would mean the suite could
embed bytes the product could not, which is the failure this card exists to remove.

`tools/test-fonts` is therefore deleted rather than kept as a shim, and its four call sites
import `@tyto/fonts`. It was never anything but this package without the ability to ship.

### The composition root binds it, and a `file` font is refused

`apps/cli` binds `bundledFont` to both halves of `ExportResources`, beside the asset
resolvers it already combines. The exporters and `pipeline` see a port, as before.

`bundledFont` answers `undefined` for a `FontRef { source: 'file' }` rather than matching it
by family. A brief that says _this family, from this file beside me_ must not be handed a
different build of the same design that happened to be bundled: that would draw the wrong
glyphs and report nothing, which is the one outcome `E_EXPORT_FONT_UNRESOLVED` exists to
prevent. Nothing loads a `file` font yet; until something does, such a scene keeps getting
the diagnostic that names the face.

### What this does not wire

`JobPorts.faces` stays unbound. `compile` measures text and decides line breaks only when it
is given faces (ADR 0019), and a render job is still given none — `tools/contract-test`
builds its own `createFaceCache` for exactly that reason, and says so. Measurement is E4.5's
seam and changing it changes the line breaks of every brief that draws a bundled family,
which is a decision with its own card. What this ADR settles is the bytes an exporter
embeds, which is a different port with a different failure.

## Consequences

`tyto render` exports a built-in template. The faces it embeds are byte-for-byte the files
in `packages/fonts/fonts/source-sans-3`, asserted on the SHA-256 of what comes out of the
binary rather than on the family name in the CSS — a name proves nothing, because it comes
from the scene and not from a resolver.

Every install now pays for the fonts: about a megabyte, in `@tyto/cli`'s dependency tree.
That was already the deal for a clone and is the deal determinism asks for; the README's
rule for adding a second family gains a sentence about it.

`visual.yml`'s path filter loses two entries and gains one. A reference render embeds the
bundled bytes, so the font and the code that reads it change the pixels as surely as an
exporter does; both are in one package now.

What this does not decide: where a font that Tyto does _not_ ship comes from. A
`FontRef { source: 'file' }` is unresolved, by the same mechanism and with the same
diagnostic as before. Whoever loads one will implement the same port.
