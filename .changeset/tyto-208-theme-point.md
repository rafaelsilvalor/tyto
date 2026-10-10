---
'@tyto/plugin-api': minor
---

TYTO-208 (ADR 0077): a twelfth extension point, `theme` — `{ id, label, kind, path }`, a data-only JSON colour theme inside the plugin's folder. `registerTheme` and `registry.themes()`; an isolated plugin may contribute one. `isThemeColor` (the colour grammar that also refuses CSS injection), `isThemePath` and `resolveThemeColors`, which fills every token a theme leaves out from the base theme of its kind.
