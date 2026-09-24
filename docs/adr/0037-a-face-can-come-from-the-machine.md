# 0037 — A face can come from the machine, and a missing one is drawn and reported

Status: accepted · 2026-09-23 · TYTO-182 · narrows the determinism rule of ADR 0021

## Context

ADR 0021 made `@tyto/fonts` the only place a face could come from, so that _same brief +
templates + fonts ⇒ same bytes_ held on every install, and it closed the other door on
purpose: _a face nobody bundles is `E_EXPORT_FONT_UNRESOLVED` naming it, never a substitute_
(`docs/architecture.md`, directive 4).

That rule met a face it cannot hold. The brand typeface of `agenda-semana` is **CircularXX** —
Black for the cover words, Medium for the discipline, the date and the session title, Light for
the professor and the handle. It is a commercial face. Estratégia holds the licence and the
machines that make the artwork have it installed — measured on the maintainer's machine: 40
CircularXX and CircularStd files, all under `%LOCALAPPDATA%\Microsoft\Windows\Fonts` and none
in `%WINDIR%\Fonts`. **The repository is public**, so the licence that lets the machine have
the files forbids the repository from carrying them. Under ADR 0021 the template could only
be drawn in Source Sans 3, which is not the brand.

The maintainer's framing, 2026-09-23: the focus is using the template locally; load the face
from the system, and where the system does not have it, say that an alternative is being used.

## Decision

### A third source: `system`

`FontRef.source` gains `'system'` beside `'bundled'` and `'file'`: a family the rendering
machine has installed, named by family and nothing else. A template asks for one with
`systemFont(family)` from `@tyto/core/template`; `font()` keeps its two meanings. It is in the
IR because what an exporter embeds is decided from the scene (ADR 0003): a `bundled` face and
a `system` one of the same family are two different requests.

### `@tyto/fonts` reads the platform's font folders, matched by the file's own tables

`createFontLibrary()` answers both ports, the exporters' `font` and `core`'s `FontSource`,
**from the same file**, so the measurement that decides the line breaks is taken from the bytes
that get drawn. The folders are the platform's own, per user first: `%LOCALAPPDATA%` then
`%WINDIR%` on Windows, `~/Library/Fonts`, `/Library/Fonts` and `/System/Library/Fonts` on
macOS, the XDG and `/usr` folders (recursively) on Linux.

A file is matched on **what its tables say, not on its name**: the preferred family (name ID
16, falling back to ID 1), the `OS/2` weight class, and italic from the slant _or_ the
`fsSelection` flag. Each rule came from the installed files, not from the specification:
CircularXX's Medium says `CircularXX Medium` in the legacy family field and `CircularXX` in the
preferred one, and CircularStd slants to -12 without setting the flag. Only the exact
`(family, weight, style)` is taken — the CSS fallback to a neighbouring weight would draw a
Book where Medium was asked for and call it a match.

Only files whose **name starts with the family** are opened. `%WINDIR%\Fonts` alone is 534 files
and 388 MB here, and parsing all of them to find one family would be most of a render. A face
whose file is named after something else is not found. That is declared, not worked around.

Reading a face's tables needs fontkit, and `@tyto/fonts` is the one package the desktop ships
outside its bundle (`electron-builder.yml` excludes `node_modules` and re-includes only that
package's `dist/` and `fonts/`). An import of fontkit there is a module the packaged app does
not contain. So `core`, which already bundles fontkit to measure text, exports `describeFace`,
and the composition root hands it to the library. Naming a face from bytes opens no file, so
`core` stays pure.

### A missing face is drawn in a bundled one, and says so

A `system` face the machine lacks is drawn in the bundled **Source Sans 3 at the nearest
weight**, upright — 300 and 500 become 400, 900 becomes 700. Measurement and export substitute
identically, so the artwork is complete and its line breaks match its pixels. And a
**`W_FONT_SUBSTITUTED`** warning names both faces, once per face, in `result.json`, in the CLI's
output and in the desktop preview.

It is raised by `pipeline`'s `loadResources` stage, which may now answer with diagnostics. It
is the one stage that sees the scene's faces before the exporters ask for bytes. The resolvers
answer with bytes and have no channel for saying whose bytes they were. The desktop preview,
which compiles without a job, raises it from the same function.

`sceneResources` stops listing a declared font at `400`/`normal` when its runs already draw it.
Measured while building this: the agenda draws CircularXX at 300, 500 and 900, and the fourth,
declared-only 400 produced a warning about text that does not exist. A declared font no run
draws is still listed at 400, for ADR 0021's reason.

### What stays exactly as it was

A `bundled` face is never looked for on the machine and is never substituted: one this package
does not ship is still `undefined`, and still `E_EXPORT_FONT_UNRESOLVED`. A `file` face is still
refused. Nothing here commits, downloads or caches a CircularXX file.

## Consequences

Directive 4 now reads per machine for a `system` face: the same brief gives the same bytes on
two machines that have the same files installed. That is weaker than ADR 0021, on purpose, and
only for the faces that opt into it.

**CI always draws the substitute**, because its runners have no CircularXX. The suites that
must agree across machines build their library with no font folders, so they measure what CI
measures on every machine. The one contract test that renders through the binary asserts
whichever outcome the machine gives: the installed files and no warning, or the substitute and
one warning per face.

The machine's folders are read once per process. A face installed while `tyto watch` or the
desktop app is running is seen after a restart.

`tyto render` and the desktop export now both measure text. The desktop export was given no
faces before this; the CLI got them in TYTO-173.

Rejected: committing CircularXX under a private licence file (the repository is public);
fetching it from a brand server at render time (ADR 0011: Tyto knows no remote service); and a
substitute declared per template (one bundled family exists, so the choice has one answer until
a second family ships).
