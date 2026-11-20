---
'@tyto/command-line': minor
---

`tyto render`, `tyto watch`, `tyto guide` and `tyto mcp` draw a file an installed plugin
decodes (TYTO-742, ADR 0223): `capa.psd` as a whole, `capa.psd#arte` as one layer, decoded
once into `TYTO_HOME/cache/decoded/` and read from there until the file or the plugin changes.
A restricted folder decodes nothing new and says to trust it; `tyto watch` decodes. With no
decoder installed for the kind, the brief's line says a plugin is needed. `tyto guide` names a
cited layer's guide after its file, never the layer, and `tyto mcp` confines the cited file to
its folder while drawing the decoded picture from the cache.
