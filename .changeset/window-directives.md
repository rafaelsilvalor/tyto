---
'@tyto/desktop': minor
---

TYTO-49: plugin directives work in the window. An installed plugin's `::namespace/name` is
resolved by the preview and by the export, in the plugin's own process, and without the plugin
it is `E_UNKNOWN_DIRECTIVE`, underlined on its name. The brief editor gains the underline and the
completion list it never had: after `::` it offers the template's slots and the plugins'
directives, and adjustments and enum values where they apply. Both are fed by the preview's
answer, so the underline, the problems panel and the list come from one pass in main.
