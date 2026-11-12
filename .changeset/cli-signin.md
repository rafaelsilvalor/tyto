---
'@tyto/core': minor
'@tyto/plugin-api': minor
'@tyto/command-line': minor
'@tyto/cli': minor
'@tyto/desktop': patch
---

The command line signs in through the browser (TYTO-683, ADR 0194). `tyto signin <plugin> [id]`
runs the sign-in the desktop runs and keeps the refresh token in the system keychain through
`@napi-rs/keyring` (at most 2,560 bytes a value, no plaintext fallback); `--client` asks for
the OAuth client a manifest leaves out, never reading it from the command line. `tyto signout`
forgets it. Every command that loads plugins answers `host.signin.accessToken` from it, and
`E_SIGNIN_REQUIRED` now says how to sign in on the host that answers it, through the new
optional `HostCapabilities.describeSignin`. The window's command panel refuses both commands.
