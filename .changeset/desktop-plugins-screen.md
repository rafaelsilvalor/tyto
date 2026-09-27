---
'@tyto/desktop': minor
'@tyto/cli': patch
---

TYTO-47: the desktop lists its plugins (File > Show plugins): the built-ins it activated and what
`tyto plugin install` put under `~/.tyto`, with each one's status, permissions and the reason a
refused one will not load, and the notice that permissions are recorded and not yet enforced. It
is read-only and activates no installed plugin. Both apps now honour `TYTO_HOME` in place of
`~/.tyto`.
