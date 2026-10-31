---
'@tyto/plugin-api': minor
'@tyto/command-line': minor
---

`tyto gallery list | install | update` reads the curated index when neither `--index` nor `TYTO_GALLERY_INDEX` names one (TYTO-506, ADR 0162): `DEFAULT_GALLERY_INDEX`, a plain git location exported by `@tyto/plugin-api`. `--index` wins over the variable, and the variable over the default.
