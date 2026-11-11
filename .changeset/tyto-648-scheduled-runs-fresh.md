---
'@tyto/desktop': patch
---

A scheduled recipe run reads its sources live, past every plugin's own cache, so a recipe on
`every 5m` sees what changed at its next tick. A person's Run still uses the caches.
