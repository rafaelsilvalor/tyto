---
'@tyto/desktop': minor
'@tyto/command-line': patch
---

Removing a plugin from the plugins screen can forget its secrets (TYTO-682): the remove box has
an unticked checkbox, "Also forget this plugin's saved credentials and sign-ins", which deletes
the plugin's `plugin:`, `signin:` and `signin-client:` keychain entries once the remove
succeeds. `tyto plugin remove` never touches the keychain, and now says so in one line.
