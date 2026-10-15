---
'@tyto/theme-pack': minor
---

TYTO-301 (ADR 0089 decision 8): every theme sets the status bar's ten new tokens, 40 in all.
The vim mode badge derives from the theme's roles — normal from `accent`, insert from `success`,
visual from `syntax-keyword`, replace from `error` — and reads 4.5:1 in every theme, originals
included. A badge colour moved off its role to get there is listed in the new `derived` field
(`ThemeDerivation`); because the badge is Tyto's and not upstream's, the move never makes a theme
a pair, and an original and its adjusted twin draw the same badge.
