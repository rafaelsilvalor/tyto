---
'@tyto/desktop': minor
---

A plugin's panel calls its own plugin's process from the window (TYTO-372, ADR 0173): the
bridge offers `call` with `args: [method, params?]`, and main finds the
panel from the layout id read off the iframe's element, plugin and panel id together, and hands
the request to `callPanel`, so a page reaches its own plugin and no other, fetched plugins
included. A bridge request with a key its shape does not have, such as a `plugin` naming
another plugin, is now answered `E_PANEL_CALL` (`E_PLUGIN_CALL` for the other capabilities)
instead of being dropped in silence.
