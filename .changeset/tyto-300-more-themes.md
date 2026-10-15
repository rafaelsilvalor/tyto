---
'@tyto/theme-pack': minor
---

TYTO-300 (ADR 0089 decision 7): nine more themes and the originals. One Dark, Nord, Solarized
Dark and Light, Gruvbox Dark and Light, Catppuccin Mocha, Tokyo Night and Tokyo Night Light join
Dracula and Catppuccin Latte. A theme whose upstream colours fail a contrast floor now ships twice:
the original under upstream's name, with upstream's colours exactly and `"variant": "original"`,
and `<Name> (adjusted)`, which meets the floors and lists each change in `adjusted`. `dracula` is
now the original and `dracula-adjusted` the version PR A shipped as `dracula`. Only the two
Catppuccin flavours pass as they are and ship once. `THEME_PACK_VARIANTS` says which of a pair
each theme is.
