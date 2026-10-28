---
'@tyto/plugin-api': minor
'@tyto/desktop': patch
---

A source's `page` request carries `refresh: true` on a run without cache, so the source skips its private cache and fetches; an ordinary run carries no key. The isolation protocol moves to 9, so a plugin process on 8 is refused at `hello`. The desktop's recipe notebook hands the flag on when a run is asked to start fresh.
