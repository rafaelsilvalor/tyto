---
'@tyto/plugin-api': minor
---

TYTO-679: a template running in its plugin's process receives `artworks`, every artwork's
adjustments (ADR 0203), with the call. Each entry holds adjustments alone; a call carrying more
is refused before the template runs.
