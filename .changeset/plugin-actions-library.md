---
'@tyto/command-line': minor
---

TYTO-373: `installPlugin` and `changePluginState` install, remove, disable and enable a plugin
as steps that answer a `Result`, for the window to call as `tyto plugin` does. `tyto plugin
install` also takes a local `.tgz` or `.tar.gz` archive, unpacked with `tar` and no npm, and
its permission prompt says what `workspace:read` and `workspace:write` reach.
