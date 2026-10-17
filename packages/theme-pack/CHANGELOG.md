# @tyto/theme-pack

## 0.1.0

### Minor Changes

- 3b9ca57: TYTO-293: the editor draws a thin vertical guide at each indent level, as VS Code does, and the
  guide of the block holding the cursor in a stronger colour. A blank line inside a block keeps
  the guide; one between two blocks breaks it. The guides appear in brief tabs, the JSON tabs
  (settings, keybindings, snippets) and both buffers of the template mode. `"indentGuides": false`
  in `settings.json` hides them on save, with no restart. Two theme tokens are new,
  `indent-guide` and `indent-guide-active`, set by every built-in and pack theme (42 tokens).
- 6670e15: TYTO-300 (ADR 0089 decision 7): nine more themes and the originals. One Dark, Nord, Solarized
  Dark and Light, Gruvbox Dark and Light, Catppuccin Mocha, Tokyo Night and Tokyo Night Light join
  Dracula and Catppuccin Latte. A theme whose upstream colours fail a contrast floor now ships twice:
  the original under upstream's name, with upstream's colours exactly and `"variant": "original"`,
  and `<Name> (adjusted)`, which meets the floors and lists each change in `adjusted`. `dracula` is
  now the original and `dracula-adjusted` the version PR A shipped as `dracula`. Only the two
  Catppuccin flavours pass as they are and ship once. `THEME_PACK_VARIANTS` says which of a pair
  each theme is.
- 3c13b00: TYTO-300 (ADR 0089): a new package, a theme plugin with well-known colour themes ported to Tyto's
  30 tokens. The first two are Dracula (dark) and Catppuccin Latte (light). Every theme sets every
  token; a theme that meets AA on the pairs the window draws text on ships once, and a colour
  changed from upstream to get there is named in the adjusted version's `adjusted` field — Dracula
  (adjusted)'s secondary text is `#9fa9c7` instead of `#6272a4`, which read 3.03:1. `LICENSES`
  records each palette's source, version and MIT notice.
- e964def: TYTO-301 (ADR 0089 decision 8): every theme sets the status bar's ten new tokens, 40 in all.
  The vim mode badge derives from the theme's roles — normal from `accent`, insert from `success`,
  visual from `syntax-keyword`, replace from `error` — and reads 4.5:1 in every theme, originals
  included. A badge colour moved off its role to get there is listed in the new `derived` field
  (`ThemeDerivation`); because the badge is Tyto's and not upstream's, the move never makes a theme
  a pair, and an original and its adjusted twin draw the same badge.

### Patch Changes

- d218cbe: TYTO-301 (ADR 0089 decision 8): vim's four modes no longer share a badge colour in any theme.
  In 10 of the 20 themes two modes wore the same colour, because their roles are one colour
  upstream; one of the two now takes another colour of the same palette, the hue vim themes give
  that mode: Dracula's visual is its purple; Gruvbox Dark's and Light's normal is the palette's
  blue and visual its purple; Solarized Dark's and Light's visual is Solarized's magenta, with the
  lightness moved to read 4.5:1. Each original and its adjusted twin still draw the same badge.
  A `derived` note names the colour used in its new optional `from` field
  (`ThemeDerivationSource`), and the closest two badges of every theme are now at least
  CIEDE2000 ΔE 10 apart.
- Updated dependencies [d4a6939]
- Updated dependencies [7342c02]
- Updated dependencies [15997e9]
- Updated dependencies [fe85505]
- Updated dependencies [5a0c7c5]
- Updated dependencies [bf3fd0e]
  - @tyto/plugin-api@0.5.0
