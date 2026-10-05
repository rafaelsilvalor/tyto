---
'@tyto/cli': patch
---

TYTO-232: `tyto render` and `tyto watch` exit 0 when a plugin is installed. Closing an idle plugin's process waited for its exit with nothing holding the event loop open, so Node ended the CLI with 13 (an unsettled top-level await) after a render that had succeeded. The rendered files are unchanged.
