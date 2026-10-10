# 0075 — One token file is the window's visual language, and the editor reads it too

Status: accepted · 2026-10-10 · TYTO-96 · amends the look ADR 0024 left to this card

## Context

Until this ADR the window had no visual decision in it. Counted on `main` at `9727c28`:

- `apps/desktop/src/renderer/shell.css`, 1,426 lines, held four colour tokens (`--ink`,
  `--ground`, `--muted`, `--line`) redefined under `prefers-color-scheme`, and beside them 31 hex
  literals (18 distinct), 15 `rgb()`/`rgba()`/`color-mix()` values, 17 `px` radii and six font
  stacks — `system-ui` on the body and `ui-monospace` five times. Every one was in that file.
- `@tyto/editor`'s `theme.ts` held a second, unrelated system: a 25-field `Palette` with two
  literal instances, light and dark. Nothing made the two agree, and nothing in `apps/desktop`
  ever called `setTheme`, so the editor opened `light` and stayed white in a dark window
  (TYTO-96, comment 1291578).
- The editor's selection colour never showed while the editor was focused: CodeMirror's base
  rule `&light.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground` out-ranks
  the theme's `&.cm-focused .cm-selectionBackground`, so light showed CodeMirror's lilac and dark
  a selection 4/18/12 per channel above its background (comment 1291677).

The card asks for one look, Zed's: dense type, almost no chrome, flat panels separated by a
hairline, one accent used sparingly; light and dark following the system; never `system-ui`.
The note on the card (comment 1277927) asks one thing more — that the vocabulary be named by
role, so a theme later is a reader that sets values rather than a rewrite.

## Decision

**1. One token file, the only place a literal lives.** `src/renderer/tokens.css` declares every
custom property the window and the editor read, prefixed `--tyto-` and named by the role it
plays, never by the colour it is: `surface`, `surface-raised`, `surface-sunken`; `border`,
`hairline`; `text`, `text-muted`, `text-disabled`; `accent`, `accent-text`, `focus-ring`,
`selection`, `hover`, `button-on`; `error`, `warning`, `info`, `success`; `font-ui`,
`font-mono`, `text-xs`…`text-lg`, `space-1`…`space-6`, `radius-sm`, `radius-md`,
`hairline-width`; and eight `syntax-*` roles. A handful more name what has no other home — the
checkerboard behind an artwork, the scrim and shadows of an overlay, the page behind a plugin's
panel, and the editor's active line. `shell.css` and every other renderer file read tokens and
declare none. **`button-on`** is the background of a button that is on, about 22 % grey in both
themes, which TYTO-248's status bar uses.

**2. The palette is Zed's One Light and One Dark** (the maintainer's choice). The six anchors per
theme — surface, raised, border, text, muted, accent — were written from memory of Zed's themes,
not measured off Zed; the other roles are derived to agree with them and were judged in the
real window at 900x600. Two deviations are measured rather than taste: the dark `error` is
`#d87b80` and not Zed's `#d07277`, which read at 4.24:1 on the surface where errors are text; and
the dark `selection` is `#3e4451` mixed with the accent at 30 %, `#4e647e`, 2.30:1 against the
surface where the old one was barely distinguishable.

**3. The UI face is Source Sans 3, bundled.** `@font-face` reads the two `.woff2` files
`@tyto/fonts` already ships (ADR 0021) through a renderer alias, `@tyto-fonts`, which
`electron.vite.config.ts` points at that package's folder through its exported `package.json`.
Vite copies the files into the renderer bundle's `assets/`, so the window reads its own copy
under `font-src 'self'` in development and in the packaged app alike — the opposite of main,
where `@tyto/fonts` must stay external because it reads its own folder at run time. There is no
600 and no italic face, so the UI uses 400 and 700 only (`--tyto-weight-strong`). **The mono
face stays a system stack, provisionally**, and only inside `--tyto-font-mono`: a bundled mono
face is a new dependency and that is the maintainer's call later.

**4. Light and dark follow the system, live, and there is no override in the app.** The token
file redefines its colours under `prefers-color-scheme: dark`, which Electron answers from the
system; nothing restarts. An in-app override is a new setting, and this batch builds only the
mechanism: the override moves to TYTO-208, which the card's acceptance criterion about it
therefore no longer binds.

**5. One source for the window and the editor.** Each `Palette` field in `@tyto/editor` is a
`var(--tyto-…)` reference, and fields that always shared a colour share a role — twenty-five
fields over fifteen roles. CodeMirror's `EditorView.theme` takes any CSS value, so the colours
change with the window's properties and need no reconfiguration. `themeTokens` exports the list
for a host to define. A host that defines none gets an uncoloured editor, which is visible,
rather than a second palette that silently disagrees with its window. `setTheme` survives for
the one thing CSS cannot reach, CodeMirror's base `dark` flag (search panel, tooltips), and the
desktop drives it from `matchMedia('(prefers-color-scheme: dark)')` at open and on change, for
the brief editor and for the template mode's two views. `restore` now brings a stored tab up to
the theme the editor is in, as it already did for the input layer.

**6. The selection rule repeats CodeMirror's base selector** —
`&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground` — so the two tie on
specificity and the theme's, mounted later, wins in both themes.

**7. Icons are not here.** Their approved geometry stays in the card (comment 1291169) and goes
in with TYTO-248, which also uses `button-on`. Every string stays in `shared/i18n`.

**8. A theme later only sets the custom properties.** TYTO-208 can add a file, a setting or a
plugin contribution that assigns values to the same names; no rule in `shell.css` and nothing in
the editor changes. That is the whole reason the names are roles.

## Consequences

- `e2e/renderer-tokens.test.ts` is the guard jsdom cannot be. It fails when any `var(--tyto-x)`
  in a renderer file, in the token file or among `@tyto/editor`'s `themeTokens` names a token
  the file does not define (the browser would drop that property without a word); when a dark
  token has no light twin; and, as the card's acceptance grep, when a renderer file other than
  the token file writes a hex, a colour function, a named colour, a `px` radius, size, spacing or
  border, a font stack or a numeric weight, or declares a custom property of its own. It also
  holds the contrast floors — text 7:1 and secondary text, errors and selected text 4.5:1 on
  their surfaces, comments 3:1 — and TYTO-246's translucent active line, whose colours moved
  here from the editor.
- `e2e/theme.desktop.test.ts` reads the colours a browser actually resolved: the bundled face
  loaded at 400 and 700, the window and the editor painting the same surface in light, then
  dark, then light with no restart (switched from main with `nativeTheme.themeSource`), and a
  focused selection in the token colour in both. Playwright emulates a light colour scheme on
  every page unless told `emulateMedia({ colorScheme: null })`, which is why `themeSource` alone
  moved nothing at first.
- The layout is flatter: no padding or gap around the shell, panels without border or radius,
  splitters drawn as a hairline with a wider grab area, a raised strip for the header, the tabs,
  each panel's bar and the footer. Layout measurements (a column's width, a dot's size) stay
  literal in `shell.css`, because they are about one rule and not about the look.
- `packages/editor/demo` borrows the desktop's token file to have colours at all; its picker now
  flips only the base flag, and the colours follow the system.
- What is not decided: the theme file format, where a theme comes from and who may contribute
  one (TYTO-208); a bundled mono face; and styling the editor's own panels and tooltips beyond
  CodeMirror's light and dark defaults.
