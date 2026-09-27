---
'@tyto/plugin-api': minor
'@tyto/desktop': minor
---

TYTO-49: plugin panels (ADR 0045). A `panel` contribution names a page inside the plugin's
folder (`entry`) and crosses from an isolated plugin as data. The desktop serves it as
`tyto-plugin://<plugin>/<entry>`, confined to that folder and with no network, into an iframe
with `sandbox="allow-scripts"` alone: it cannot read the window, the app's storage or the
preload, and its frame stays on its own plugin's pages. It asks the host for `fetch` and
`credentials` through a `postMessage` bridge checked against the plugin's permissions. It hears
the open brief's text, which the plugins screen now states. It opens closed from the command bar,
and the bottom dock lays its panels side by side. The template mode's sample brief resolves
plugin directives.
