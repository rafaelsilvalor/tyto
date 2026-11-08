---
'@tyto/desktop': minor
---

TYTO-374: the desktop runs a plugin's browser sign-in in its main process: PKCE with a loopback redirect
on `127.0.0.1`, the refresh token in the keychain and the access token only in memory, refreshed
when it expires. A plugin's `host.signin.accessToken(id)` now answers a token once somebody has
signed in. The window that starts a sign-in comes next.
