# Bundled fonts

Fonts that ship with the repository, one folder per family. They are what
`FontRef { source: 'bundled' }` in the Scene IR means (`docs/ir-schema.md`), and today
they exist so that fixtures carrying text can be exported and rasterized at all.

## Why this is at the root and not in a package

Four places want the same bytes and none of them owns them: `export-html` and `export-svg`
embed a face as a `data:` URI, `raster` rasterizes the result, and `core` will measure
glyphs with them once E4.5 lands. A `__fixtures__` folder inside any one of those would
make the other three reach across a package boundary for test data, and ADR 0010 spends
its whole budget on packages not reaching into each other.

They are also not test data in the way a `.brief` fixture is. A bundled font is a
licensing and provenance commitment that outlives whichever test reads it first, so it
sits where a licence audit finds it without knowing what a fixture is.

Reading the bytes is `tools/test-fonts`, which is the only thing that knows this path.
Nothing else hard-codes it.

## What is here

| Family        | Version | Faces                 | Licence |
| ------------- | ------- | --------------------- | ------- |
| Source Sans 3 | 3.052R  | Regular 400, Bold 700 | OFL 1.1 |

Two faces rather than one because the exporters key a `@font-face` on family **and**
weight, and a corpus with a single weight cannot tell a resolver that ignores the weight
from one that honours it. Italic is deliberately absent: it is the face the suite asks for
in order to watch the resolver answer `undefined` and the exporter report
`E_EXPORT_FONT_UNRESOLVED`, which is the behaviour a missing face is supposed to have.

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
5. Register the faces in `tools/test-fonts/src/index.ts`. Nothing discovers this folder by
   listing it: a font that no list mentions is a font nobody decided to bundle.
6. Say in the PR why the repository needs a second family. Each one is about a megabyte
   that every clone pays for forever.
