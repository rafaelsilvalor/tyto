---
'@tyto/theme-pack': minor
---

TYTO-300 (ADR 0089): a new package, a theme plugin with well-known colour themes ported to Tyto's
30 tokens. The first two are Dracula (dark) and Catppuccin Latte (light). Every theme sets every
token; a theme that meets AA on the pairs the window draws text on ships once, and a colour
changed from upstream to get there is named in the adjusted version's `adjusted` field — Dracula
(adjusted)'s secondary text is `#9fa9c7` instead of `#6272a4`, which read 3.03:1. `LICENSES`
records each palette's source, version and MIT notice.
