# 0077 — A colour theme is a data file a plugin contributes

Status: accepted · 2026-10-10 · TYTO-208 · builds on ADR 0075, ADR 0045 and ADR 0073

## Context

ADR 0075 made the window's look one token file, `apps/desktop/src/renderer/tokens.css`: 84
`--tyto-*` declarations named by role, 30 of them redefined under
`prefers-color-scheme: dark`, and `@tyto/editor`'s 25 palette fields reading the same
properties. It left three questions to this card: the theme file's format, where a theme comes
from, and who may contribute one. TYTO-208 asks for themes as VS Code and Zed have them — a
plugin ships a colour theme and the person picks it — with the current look moved into a
built-in theme and the window pixel-identical to `main`.

The card ships in two pull requests, and this ADR covers both. PR A builds the contribution
point, the reader and the two built-in themes, and changes nothing on screen. PR B adds the
`theme` setting, the "Preferences: Color Theme" command with a live preview, a test plugin
with a second theme and the end-to-end suite for a malformed one.

## Decision

**1. The theme file is data-only JSON.** `{ name, kind: "light" | "dark", colors: { … } }`.
Applying a theme runs nothing the plugin wrote. The reader is `jsonc-parser`, as for
`settings.json` (ADR 0073), so a comment is tolerated and every key and value has a range.

**2. One vocabulary: the role names without the prefix.** `surface`, `text-muted`,
`syntax-keyword` — the `--tyto-*` colour roles of ADR 0075, with a mechanical mapping to the
custom property and no second, dotted vocabulary (`editor.background`) to translate. **The set
is exactly the 30 colours `tokens.css` redefines for dark.** Type, size, space, radius and the
colours that do not change with the mode (`button-on`, the checkerboard, the plugin page) are
not themeable. To make every themed token a colour, the two shadows were split: their
geometry stays in `tokens.css` once, and their colours are two new roles,
`shadow-overlay-tint` and `shadow-paper-tint`. Which names exist is the base theme's to say:
`plugin-api` is handed the base colours and calls every other name unknown, so the list lives
in one place.

**3. A value must be a colour.** A hex colour, `rgb()`/`rgba()`, `hsl()`/`hsla()` with numbers
inside, or a `color-mix()` of two of those — `isThemeColor` in `plugin-api`, a regular
expression in a pure package. **It is also the injection check**: the value becomes the
right-hand side of a custom property in the window's sheet, and the grammar admits no `;`,
`}`, quote or `url(`. It is checked in main and again by the bridge's schema on the renderer's
side. Named colours and `hsl()` with an angle unit are refused, which a theme author can live
with.

**4. Fallback, token by token and file by file.** A token a theme leaves out is the base
theme's of the same kind (Tyto Light or Tyto Dark). An unknown name is `W_THEME_TOKEN_UNKNOWN`
at the name and applies nothing; a value that is not a colour is `W_THEME_COLOR_INVALID` at the
value and keeps the base's colour. A file that cannot be read, does not parse, is not an
object, has no `name`, has a `kind` that is not light or dark or disagrees with the
contribution's, or has no `colors` object is one `E_THEME_INVALID` with its range, and the
base theme of the contribution's kind applies whole. **The window never breaks**: none of the
three codes is fatal.

**5. The `theme` contribution point, the twelfth.** `{ id, label, kind, path }`, `path` a
relative path inside the plugin's folder with `/` between segments. It is validated at
registration (`checkThemeContribution`: an empty id or label, a kind that is not light or dark,
a path with an empty, `.` or `..` segment, a drive, a colon, a backslash or a NUL throws, and
the loader's door makes the throw `E_PLUGIN_ACTIVATE`), and on the disk with the same
`realpath` and relative check a panel's page goes through (`confinedFile`, shared with
`plugin-protocol.ts`): a link or junction leading out of the folder is refused, as a file that
is not there is, with `E_THEME_INVALID`.

**6. An installed plugin may contribute a theme.** The contribution is four strings, not a Zod
schema, so it crosses the isolation boundary as data: `theme` is in `ISOLATED_POINTS` and not
in `NOT_YET_ISOLATED`. Main reads the file, validates it and sends the colour map over IPC
(`theme:current`); the renderer writes it into one `<style>` element under `:root:root`, light
at the root and dark under the same media query `tokens.css` uses, so a change of the system's
mode stays CSS alone. The window's policy already allows inline styles, and the doubled
selector wins over `tokens.css` whatever order the two sheets land in.

**7. Built-in is a plugin.** The `desktop` plugin registers Tyto Light and Tyto Dark through the
same point (`src/main/themes/tyto-light.json`, `tyto-dark.json`). Their files are bundled into
main rather than shipped beside it, so the built-in reader answers from those imports and the
installed reader from the plugin's folder; the parse, the shape check and the fallback are the
same code for both. **`tokens.css` keeps its colours as the first paint and the fallback**, and
`e2e/renderer-tokens.test.ts` requires both files to equal it exactly — the same 30 names, the
same values — so there are never two truths. The contrast floors of ADR 0075 are measured on
the built-in files. **A third party's theme is not held to any floor**: it is the person's
choice to install, and a guard on somebody else's colours would refuse a high-contrast or a
deliberately quiet theme alike.

**8. Until PR B the applied theme is the built-in of the system's kind.** There is no setting
and no command in PR A, and installed themes are registered but never applied. PR B lifts all
three (see Consequences).

**9. PR B, decided now.** The `theme` setting has Zed's shape, either one theme id or
`{ mode: "system" | "light" | "dark", light: <theme id>, dark: <theme id> }`, declared by the
`desktop` plugin through `configuration`. "Preferences: Color Theme" in the command bar lists
every theme, previews the highlighted one live and writes the setting on choosing. A test plugin
ships a second theme, and an end-to-end test proves a malformed theme file gives a diagnostic in
the problems panel and falls back without breaking the window.

**10. Out of scope.** Icon themes and font themes are out: an icon set is geometry the window
draws, and a font is a dependency question (ADR 0075). **A theme never touches exported
artwork**: an artwork's colours come from its template and brand kit, and an exporter never
sees the window's tokens.

## Consequences

- `plugin-api` gains the `theme` point (`registerTheme`, `registry.themes()`), `isThemeColor`,
  `isThemePath`, `resolveThemeColors` and `checkThemeContribution`. A minor version.
- `core` gains `E_THEME_INVALID`, `W_THEME_TOKEN_UNKNOWN` and `W_THEME_COLOR_INVALID`. In PR A
  main writes them to the log; PR B shows them in the problems panel.
- The desktop gains `theme:current`, `src/main/themes.ts` and `src/renderer/theme.ts`. The
  window paints `tokens.css` first and then the same colours from the theme, measured
  pixel-identical to `main` at 900x600 in light and dark with Electron's `capturePage`.
- Changing a built-in colour is now two edits — the token file and the theme file — and the
  token guard fails until both agree. That is the price of keeping a first paint that needs no
  message from main.
- PR B (`shared/theme-setting.ts`, `theme:list`, `theme:preview`, `theme:choose`,
  `e2e/theme-pick.desktop.test.ts`) settles five details decision 9 left open. **The mode is
  Electron's**: main sets `nativeTheme.themeSource` from it — at launch before the window
  exists, and on every change — so the sheet's media query, CodeMirror's dark flag
  (`color-scheme.ts`, unchanged) and the native dialogs, scrollbars and menus follow one value;
  a fixed id is the mode of its kind. **A slot holds its own kind**: an id no plugin offers, or
  a dark theme in the `light` slot, is `W_SETTING_INVALID` at the value and the default
  applies, as for any setting; while the installed plugins are still starting an id that may
  be theirs is let through and waited for, and one that never arrives is its slot's default.
  **Previewing and choosing are main's**: the picker asks `theme:preview` on each move, and
  Escape asks it with `null`; Enter asks `theme:choose`, which writes through the settings store
  (in place, or into a settings tab with unsaved typing, ADR 0073) the setting that keeps the
  chosen theme on screen — its slot, and the mode of its kind when the system is in the other
  one. **A theme's problems reach the problems panel** with every answer, without their
  ranges: those are offsets into the theme's file, and the panel counts lines of the brief.
  Only the applied themes are read, so a broken theme nobody chose says nothing. **The picker
  is the command bar** (`pick`), not a second list: the same filter and keys, plus the moment
  a row becomes the highlighted one.
