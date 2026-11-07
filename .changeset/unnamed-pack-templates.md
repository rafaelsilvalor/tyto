---
'@tyto/core': minor
'@tyto/command-line': patch
'@tyto/desktop': patch
---

A plugin file now says when a pack it fetched holds templates none of its entries names:
`W_PLUGIN_FILE_TEMPLATE_UNNAMED`, once per pack at the first entry that fetched it, names them
and says to add an entry for each with the same git and ref. A brief naming one of them still
gets `E_UNKNOWN_TEMPLATE`, now with a hint that the pack holds it. `tyto render` and the
desktop app's problems panel show both. The registry keeps what a root with `only` skipped, in
`TemplateRegistry.unoffered` (TYTO-615).
