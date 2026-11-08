---
'@tyto/desktop': minor
'@tyto/command-line': patch
---

TYTO-373: the plugins screen installs a plugin from a folder or a `.tgz` archive, after a native
box that shows the same permissions `tyto plugin install` prints, and removes, disables and
enables an installed one; Settings opens `settings.json` at the plugin's keys. Changes apply the
next time Tyto starts, and each row says so. `tyto plugin install --help` names the local archive,
and a test proves a hostile archive writes nothing outside the folder it is unpacked into.
