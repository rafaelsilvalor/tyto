# 0089 — Themes Tyto distributes are held to AA

Status: accepted · 2026-10-15 · TYTO-300 · extends ADR 0077 decision 7

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

**1. A theme Tyto distributes is held to WCAG AA on the pairs the window draws text on.**
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
sits in. Dracula's `text-muted` is `#9fa9c7`: `#6272a4` with HSL lightness raised from 51.4 % to
70.2 %, reading 6.09 on `surface`, 5.04 on `surface-raised` and 4.51 on `hover`. Catppuccin
Latte needed none.

**5. Provenance travels with the colours.** `packages/theme-pack/LICENSES` records each theme's
source, upstream version and commit, licence and how the palette maps onto Tyto's roles, with
the upstream licence text; the desktop's `electron-builder.yml` ships that file with the app.
Names are upstream's; no logo or branding is shipped.

**6. A third party's theme is still held to no floor.** ADR 0077 decision 7 stands for what a
person installs. This ADR covers only what Tyto itself distributes.

## Consequences

- A port whose look depends on a low-contrast colour ships with that colour changed and
  documented, not as upstream. A person who wants the original can install it as a plugin,
  where no floor applies.
- The theme pack is a pure package bundled into main: its files are imported, never read from
  its folder, and the desktop's built-in reader answers by plugin and then by path.
- Adding a theme to the pack is a JSON file, one line in `src/index.ts` and an entry in
  `LICENSES`; the unit test picks the new theme up without an edit.
