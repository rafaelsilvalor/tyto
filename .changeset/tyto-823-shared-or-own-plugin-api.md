---
'@tyto/plugin-api': minor
---

TYTO-823: a template running in its plugin's process receives `order` with the call, its
artwork's written blocks in drawing order (ADR 0225). Each entry is a slot name and a place,
`before`, `own` or `after`; an entry carrying anything else is refused before the template runs.
