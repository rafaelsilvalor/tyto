---
'@tyto/plugin-api': minor
'@tyto/core': minor
'@tyto/desktop': minor
'@tyto/cli': patch
---

TYTO-370 (ADR 0134): an installed plugin can store and forget its own secrets. `host.credentials` is now a function with two methods: `host.credentials(key)` reads as before, `host.credentials.set(key, value)` stores, and `host.credentials.delete(key)` forgets and answers whether there was a value. Both need the same `credentials:<key>` permission, so an undeclared key is `E_PERMISSION`, in process and across the isolation boundary. A value is a non-empty string of at most 16 KiB in UTF-8 (`CREDENTIAL_VALUE_LIMIT_BYTES`); over it is the new `E_CREDENTIAL_TOO_LARGE` from `@tyto/core`. `HostCapabilities` gains optional `storeCredential` and `deleteCredential`; a host without them answers the new `E_CREDENTIAL_READ_ONLY`. The isolation protocol is 5. The desktop stores in the keychain, under the `plugin:<name>:<key>` account it already reads, lets a plugin's panel store and forget its own declared keys, and holds the plugins screen to the same 16 KiB. `tyto` stays read-only: a plugin's `set` or `delete` there is `E_CREDENTIAL_READ_ONLY`, naming the environment variable to set instead.
