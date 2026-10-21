# @tyto/fonts

The fonts Tyto ships, one folder per family under `fonts/`, and the reader that hands them
to the exporters and to measurement. They are what `FontRef { source: 'bundled' }` in the
Scene IR means (`docs/ir-schema.md`), and what design directive 4 in
`docs/architecture.md` requires of every render: _same brief + templates + fonts ⇒ same
bytes. Fonts are bundled/pinned; never `system-ui`._

## Why this is a package

The bytes used to sit in `fonts/` at the repository root, read by `tools/test-fonts`, and
the argument for that was a good one: four places want the same bytes — both exporters,
`raster`, and `core`'s measurement — and none of them owns them, so a `__fixtures__`
folder inside any one would make the other three reach across a package boundary for test
data. ADR 0010 spends its whole budget on packages not reaching into each other.

What it missed is that a folder at the repository root is a folder no install ever sees. A
package's `files` cannot reach above its own directory, so nothing published could carry
those bytes, and `tools/test-fonts` said so in its own doc comment: _"a published package
that reads a path relative to the repository root would be a bug waiting for its first
consumer."_ The consequence was that the visual suite rendered real glyphs and `tyto
render` could not export a single built-in template, four `E_EXPORT_FONT_UNRESOLVED` per
run (TYTO-87).

A package whose only subject is the fonts answers both. It owns the bytes, so nobody
reaches into anybody; it ships them, so an install has them. ADR 0021 has the rest of the
argument, including why this one is a Node package where `@tyto/templates` is a pure one.

They are also not test data in the way a `.brief` fixture is. A bundled font is a licensing
and provenance commitment that outlives whichever test reads it first, which is why
`LICENSE.md` sits beside the files and this folder is where a licence audit finds it
without knowing what a fixture is.

## What is here

| Family        | Version              | Faces                                              | Licence | Read by                 |
| ------------- | -------------------- | -------------------------------------------------- | ------- | ----------------------- |
| Source Sans 3 | 3.052R               | Regular 400, Bold 700, Italic 400, Bold Italic 700 | OFL 1.1 | renders and the window  |
| IBM Plex Mono | @ibm/plex-mono@2.5.0 | Regular 400, Bold 700                              | OFL 1.1 | the desktop editor only |

**IBM Plex Mono is the window's, not a render's** (TYTO-269, ADR 0075). The desktop renderer
reads its two `.woff2` files through the `@tyto-fonts` alias, as it does Source Sans 3's, so the
brief editor has the same face and the same columns on every machine. It is deliberately not
in `BUNDLED` in `src/index.ts`: registering it would put it in `BUNDLED_FONT_FAMILIES`, which
lets a scene name it and changes how `system.ts` decides what is bundled, and nothing on the
export side asked for that. The `.ttf` files are committed anyway, from the same archive, so
that registering it later is one table entry and not a second download (rule 2 below). "Plex"
is a Reserved Font Name under the OFL; the files are shipped unmodified and under their own
name. There is no italic face — the editor's italic comments are the Regular face slanted by
the browser.

Two weights rather than one because the exporters key a `@font-face` on family **and**
weight, and a corpus with a single weight cannot tell a resolver that ignores the weight
from one that honours it. **Italic ships since TYTO-329** (ADR 0110): `*text*` is ordinary
brief syntax, and without the face it compiled cleanly and then failed at export. Before
that, italic was left out on purpose as the face the visual suite asked for to watch the
exporter report `E_EXPORT_FONT_UNRESOLVED`; the suite now asks for weight 300, which
nothing ships, and a face the source cannot answer is also a compile-time error,
`E_FONT_FACE_UNAVAILABLE`.

**Redistribution.** OFL 1.1 permits shipping these bytes inside Tyto, and requires the
licence to travel with them and the reserved font name to be left alone. Both hold as long
as `fonts/` stays in this package's `files` — `LICENSE.md` is inside the folder, not beside
it — and as long as nothing here renames or modifies a face. Neither the reader nor any
consumer of it touches the bytes.

## Adding another family

1. It must be **OFL 1.1 or Apache-2.0**. Nothing else, and no webfont CDN copies — the
   bytes come from the project's own release so the version is a fact rather than a guess.
2. Commit the `.ttf` or `.otf` **and** the `.woff2`, and both from the same release. The
   exporters embed the `.woff2`; fontkit measures the `.ttf`. A measurement taken against
   a face the exporter does not embed is a measurement of the wrong glyphs, and two
   downloads a year apart is exactly how that happens.
3. Keep the upstream filenames. `SourceSans3-Regular.ttf.woff2` reads oddly and says
   something true: that this `.woff2` is the compression of that `.ttf`.
4. `LICENSE.md` beside the files, carrying the upstream licence text verbatim plus a
   provenance header with the version, the release URL and the SHA-256 of every file. A
   clone with no network has to be able to answer "which version is this, and may we ship
   it".
5. Register the faces in `src/index.ts`. Nothing discovers this folder by listing it: a
   font that no list mentions is a font nobody decided to bundle, and a scan would make
   dropping a file into the tree enough to change what every render embeds.
6. Say in the PR why the repository needs a second family. Each one is about a megabyte
   that every clone, and now every install, pays for forever.
