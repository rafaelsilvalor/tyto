# 0089 — Themes Tyto distributes are held to AA

Status: accepted · 2026-10-15 · TYTO-300 · extends ADR 0077 decision 7 · amended 2026-10-15
(decision 7: originals ship beside adjusted versions, Rafael)

## Context

ADR 0077 made a colour theme a data file a plugin contributes, and drew one line about
contrast: the built-in themes are measured against the floors of ADR 0075, and **a third
party's theme is held to no floor**, because it is the person's choice to install. TYTO-300
adds a third kind of theme that line did not foresee: a well-known theme (Dracula, Catppuccin,
Nord…) that Tyto ports and ships inside the app, as `@tyto/theme-pack`. It is not Tyto's own
design, so the built-ins' floor — body text at AAA's 7:1 — would repaint the upstream look; and
it is not a third party's choice either, because Tyto is the one putting it in front of the
person.

Measured on the first two ports, upstream colours do fail ordinary floors. Dracula's secondary
text, the comment colour `#6272a4`, reads 3.03:1 on its own background and 2.24:1 on the hover
row; text at that contrast in the tab strip and the problems panel is a regression from the
built-in themes nobody would choose knowingly.

## Decision

**1. A theme Tyto distributes is held to WCAG AA on the pairs the window draws text on**,
except an original shipped beside its adjusted version (decision 7).
Measured by `apps/desktop/src/main/theme-pack.test.ts`, per theme:

| Text             | Ground                               | Floor |
| ---------------- | ------------------------------------ | ----- |
| `text`           | `surface`, `surface-raised`          | 4.5   |
| `text-muted`     | `surface`, `surface-raised`, `hover` | 4.5   |
| `error`          | `surface`                            | 4.5   |
| `text`           | `selection`                          | 4.5   |
| `syntax-comment` | `surface`                            | 3     |
| `accent`         | `surface-raised`                     | 3     |

These are the built-ins' pairs (`e2e/renderer-tokens.test.ts`) with body text at AA rather than
AAA. A comment stays at 3, deliberately quiet as in the built-ins, and the accent at 3 because
the line that marks the tab in front is a graphical object.

**2. The two active-line invariants hold as for the built-ins.** `active-line` is translucent,
so a selection drawn behind it shows (TYTO-246), and composited over `surface` it equals
`active-line-gutter` within 1 per channel.

**3. Every distributed theme sets all 30 tokens.** No token leans on the base theme's
fallback: a fallback colour is Tyto's, measured against Tyto's surfaces, and nothing proves it
reads on a ported theme's.

**4. Where an upstream colour fails a floor, the adjustment is minimal and written down.** The
theme file's `adjusted` field lists the token, the upstream value, the value shipped and why;
the test fails if a listed value is not the one the file applies. Minimal means the hue and
saturation stay and the lightness moves to the first value that passes every pair the token
sits in. Dracula (adjusted)'s `text-muted` is `#9fa9c7`: `#6272a4` with HSL lightness raised from 51.4 % to
70.2 %, reading 6.09 on `surface`, 5.04 on `surface-raised` and 4.51 on `hover`. Catppuccin
Latte needed none.

**5. Provenance travels with the colours.** `packages/theme-pack/LICENSES` records each theme's
source, upstream version and commit, licence and how the palette maps onto Tyto's roles, with
the upstream licence text; the desktop's `electron-builder.yml` ships that file with the app.
Names are upstream's; no logo or branding is shipped.

**6. A third party's theme is still held to no floor.** ADR 0077 decision 7 stands for what a
person installs. This ADR covers only what Tyto itself distributes.

**7. A theme that needs an adjustment ships twice: the original and the adjusted version**
(Rafael, 2026-10-15, amending decisions 1 and 4). The **original** keeps upstream's name
(`Dracula`) and upstream's colours exactly, is marked `"variant": "original"`, and is exempt from
the floors of decision 1 — as a third party's theme is under ADR 0077 decision 7: it is there
because a person asked for the theme as its author made it. The **adjusted** version is named
`<Name> (adjusted)`, is marked `"variant": "adjusted"`, meets every floor and lists each change
under decision 4. A theme whose upstream colours already pass ships once, with no variant and
nothing adjusted. Ids keep the original's meaning: `dracula` is the original and
`dracula-adjusted` the adjusted one (PR A's `dracula`, which was the adjusted colours, never
reached a release, so no saved `theme` setting changes what it shows). The picker shows the
suffix in the name and says "original colors" or "adjusted for contrast" on the detail line.
`theme-pack.test.ts` asserts the floors only for themes that are not originals; it holds each
original to the upstream values recorded in `apps/desktop/src/main/theme-pack-upstream.ts`,
holds it to fail at least one floor (or it would ship once), and holds an original and its twin
equal except in the colours the twin lists as adjusted.

## Consequences

- A port whose look depends on a low-contrast colour ships both ways, side by side in the
  picker: as upstream, and with that colour changed and documented. Which one a person reads in
  is their choice; the default themes stay Tyto Light and Tyto Dark.
- The theme pack is a pure package bundled into main: its files are imported, never read from
  its folder, and the desktop's built-in reader answers by plugin and then by path.
- Adding a theme to the pack is a JSON file (two for a pair), a line per file in
  `src/index.ts` and an entry in `LICENSES`, plus, for a pair, the original's upstream values
  in `theme-pack-upstream.ts`; the unit test picks the new theme up without an edit.
