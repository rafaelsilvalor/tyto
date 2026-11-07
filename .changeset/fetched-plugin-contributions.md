---
'@tyto/desktop': minor
---

A plugin the plugin files fetch now contributes to the window everything an installed plugin
does, not only its templates: panels, directives, colour themes, keys, vim mappings, brand
kits, image and font sources, settings and recipe verbs, in the preview and in the export. The
fetched set is activated before the installed plugins, so where both offer the same id the
fetched plugin's is used, as the plugin files' search order says. A sync that starts the set
again withdraws what the old one offered, and the window asks for its panels, keys and theme
again on `plugins:changed` (TYTO-466).
