---
'@tyto/plugin-api': minor
'@tyto/desktop': minor
---

TYTO-390, ADR 0192: a plugin's `signin.<id>` may leave `clientId` out, and the person types the
OAuth client in the plugins screen. The client is kept in the keychain under
`signin-client:<plugin>:<id>`, write-only like a credential; a manifest that declares its client
still wins, a `clientSecret` without a `clientId` is refused, and saving or clearing the client
ends the sign-in made with the previous one. `signin-client:` is reserved from a plugin's own
credentials, as `signin:` is.
