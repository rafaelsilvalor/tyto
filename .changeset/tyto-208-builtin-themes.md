---
'@tyto/desktop': minor
---

TYTO-208 (ADR 0077): the window's colours arrive as a theme. The built-in `desktop` plugin registers Tyto Light and Tyto Dark through the `theme` point; main reads and checks them and answers `theme:current`, and the window applies them over `tokens.css`, which stays the first paint and the fallback. Nothing on screen changes: the two files equal the token file, which a test enforces. The shadows' colours become two themed tints.
