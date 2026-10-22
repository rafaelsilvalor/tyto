---
'@tyto/plugin-api': minor
'@tyto/core': minor
'@tyto/io': minor
'@tyto/fonts': minor
'@tyto/pipeline': minor
---

TYTO-280: a plugin can supply images and fonts (ADR 0117). `@tyto/plugin-api` has two new extension points, `asset-source` (URI schemes such as `drive:`) and `font-source` (families), each with a `fetch` an installed plugin answers from its own process; the call carries the plugin's own section of the project file, absent when the folder withheld it. `@tyto/io`'s `sourceCache` asks them once and keeps the answer in `TYTO_HOME/cache/sources/<plugin>/`, named by a hash, so the next render asks nothing; a restricted folder reads the cache and fetches nothing. `@tyto/core`'s `AssetResolver` gains an optional `explain`, and a source's failure is `E_ASSET_SOURCE_FAILED` or `W_FONT_SOURCE_FAILED`. `@tyto/fonts`' library gains `refresh()`, and `@tyto/pipeline`'s `loadResources` may ask for one more compile once a fetched face arrives.
