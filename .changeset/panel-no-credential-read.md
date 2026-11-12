---
'@tyto/core': minor
'@tyto/desktop': minor
---

A plugin's panel no longer reads a credential in plaintext (TYTO-641, ADR 0173). The desktop
answers a panel's `credentials` request with the new diagnostic code `E_PANEL_CREDENTIAL_READ`,
whose message names `call`, before any permission check or keychain read; a panel reaches a
secret's effect by asking its own plugin through `call`. A panel still stores and forgets its
plugin's declared keys with `storeCredential` and `deleteCredential`.
