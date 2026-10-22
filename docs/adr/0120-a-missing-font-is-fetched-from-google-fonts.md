# 0120 — A missing font is fetched from Google Fonts, and one Google does not serve is named

Status: accepted · 2026-10-22 · TYTO-281 · under ADR 0117, ADR 0118 and ADR 0119 · amends
ADR 0117 point 1 (a built-in may contribute a source) · applies ADR 0037 and ADR 0011

## Context

Rafael asked on 2026-10-12 that a template's font the machine lacks be looked for on Google
Fonts on first use, and that a licensed one — CircularXX — only be reported, with the free
families a person could use instead. ADR 0117 already fetches a plugin's face once into a cache
and lets a local face win; ADR 0118 and ADR 0119 say who may fetch. What was missing is a source
that answers for Google, a way to tell a licensed family from one Google has, and the sentence
that says so.

Measured on 2026-10-22 against Google, read-only:

- `css2` answers a browser with WOFF2 and **anything else with TrueType** (`node`, `undici`, an
  empty and a made-up `User-Agent`), at a versioned URL: `fonts.gstatic.com/s/inter/v20/….ttf`.
- A variable family arrives as the **static instance** of the weight asked for: Inter 700 has no
  `fvar`, weight class 700, family "Inter".
- A family Google does not have answers **400**.
- `fonts.google.com/metadata/fonts` lists 1,950 families with their category and styles, and no
  licence. The licence is the folder each family sits in in `github.com/google/fonts`: `ofl/`,
  `apache/` or `ufl/`.

## Decision

1. **A built-in `font-source`, `google-fonts`, in a pure package.** `@tyto/google-fonts` imports
   nothing from Node: it reaches Google only through `host.fetch`, under
   `net:fonts.googleapis.com` and `net:fonts.gstatic.com`, and the app composes the network.
   **ADR 0117 point 1 said built-ins contribute no source; this is the one that does.** Two
   requests per face: the `css2` sheet for the family, weight and style, then the TrueType file
   it names. Every request names Tyto as its `User-Agent`, so a window whose network is a
   browser's still gets TrueType.
2. **The catalogue is a bundled snapshot.** `tools/google-fonts-catalogue` reads the two public
   sources and writes `packages/google-fonts/src/catalogue.json` — family, category, styles,
   licence, and the date — one family per line. A family the metadata lists and no licence
   folder holds is left out (6 on 2026-10-22, the `Edu` handwriting families): Tyto fetches only
   what it can say the licence of. A render never reads the catalogue from the network, so an
   offline machine still knows CircularXX is not Google's.
3. **Licensed, or unavailable, means: missing here and served by no source.** Not on this
   machine, not in the catalogue, and declared by no other plugin's `font-source`. Such a family
   is never asked for, so nothing is fetched. A family some source serves and that is still
   missing failed to arrive, and `W_FONT_SOURCE_FAILED` says why — calling it licensed would be
   false.
4. **One line per missing face.** `W_FONT_UNAVAILABLE` takes the place of `W_FONT_SUBSTITUTED`
   for an unavailable family and still names the substitute, so ADR 0037's fallback and its
   warning stay one sentence: the font, that it cannot be downloaded and is likely licensed, the
   face drawn instead, the alternatives when the template names any, and what installing it
   would change. **With Google Fonts off, a missing face is `W_FONT_SUBSTITUTED` exactly as
   before.** Diagnostics are English (one catalogue in `core`); their localisation is TYTO-356.
5. **The template names its alternatives.** `manifest.yaml` gains
   `fonts: { CircularXX: { alternatives: [Inter, Manrope, DM Sans] } }`. The template's author
   knows the brand, and a licensed face is by definition one no public catalogue can classify,
   so a curated table would be Tyto guessing. Without the key, the line names the substitute
   only. Nothing is ever drawn in an alternative on Tyto's own initiative.
6. **What leaves the machine, on by default, and how to stop it.** Each fetch sends Google a
   family, a weight, a style and this machine's address — no brief text, no template, nothing
   from the project, no cookie. It happens at most once per face per machine (ADR 0117's cache),
   only where ADR 0118 and ADR 0119 allow a fetch. It is **on by default**, because Rafael asked
   for it. It is off with `tyto render --no-google-fonts` or `TYTO_GOOGLE_FONTS=off` in the
   environment, and in the window with the setting this card's second pull request adds.
7. **Where it connects is never a project's to say.** `TYTO_GOOGLE_FONTS_BASE` points the plugin
   at a server standing in for Google, **for tests only**, and becomes its one `net:` permission.
   It is read from the environment by the app and from nowhere else: the plugin ignores its
   `section`, so no project file or work profile can point a render at another server. Tests
   never reach Google: the CLI's suite refuses Google's hosts outright.
8. **Determinism is the cache's.** A fetched face is kept until deleted (ADR 0117), so one
   machine draws the same bytes on every render, and the file's own name table carries Google's
   version (`Version 2.000`…). Two machines that fetch on different days may get different
   versions if Google updated the family between them; nothing here pins that, and it is stated
   rather than hidden.

## Consequences

- A template in a Google family renders on a machine without it after one fetch, and every
  later render reads the cache.
- CI renders the built-in pack with Google Fonts on: its only `system` family is CircularXX,
  which is not Google's, so CI reports `W_FONT_UNAVAILABLE` for it and asks nothing.
- The catalogue ages: a family Google adds after the snapshot is reported as unavailable until
  the snapshot is regenerated.
- Open: pinning a version across machines, a per-family switch, and the window's setting (the
  second pull request of TYTO-281).
