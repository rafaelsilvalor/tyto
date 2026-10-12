---
'@tyto/desktop': patch
---

TYTO-268: when a brief is written but nothing can be drawn from it — a template that does not exist, a frontmatter that will not parse — the preview now says "This brief has an error — see Problems" instead of "Write a brief to see it here", which it keeps for an empty buffer. When an artwork had already been drawn, the preview still keeps it on screen, marked as older than the text.
