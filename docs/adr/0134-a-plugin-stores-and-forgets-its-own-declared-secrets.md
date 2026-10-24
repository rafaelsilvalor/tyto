# 0134 — A plugin stores and forgets its own declared secrets

Status: accepted · 2026-10-24 · TYTO-370 · builds on ADR 0127, ADR 0131, ADR 0042, ADR 0045,
ADR 0049 and ADR 0040.

## Context

ADR 0127 lists secret write among the generic services the connectors need. Until now
`host.credentials(key)` only read, and only a person could set a value, in the desktop's plugins
screen (TYTO-187). The Google connector must keep a service-account key the person pastes once,
inside the connector's own panel, and the browser sign-in service (ADR 0131) will keep refresh
tokens. Neither fits "a person types it into the plugins screen".

## Decision

**`host.credentials` becomes a callable object.** `host.credentials(key)` reads exactly as before,
so no plugin written against the reader changes. `host.credentials.set(key, value)` stores and
resolves to nothing; `host.credentials.delete(key)` forgets and resolves to `true` when there was a
value to forget, `false` otherwise, which is not an error. Both sit behind the permission the
reader already uses, `credentials:<key>`, and both go through the one function that decides every
capability, `checkedCapabilities` (ADR 0042): an undeclared key is `E_PERMISSION` in process and
across the isolation boundary alike.

**A value is a non-empty string of at most 16 KiB in UTF-8** (`CREDENTIAL_VALUE_LIMIT_BYTES`).
Over it is `E_CREDENTIAL_TOO_LARGE`. Measured: a Google service-account JSON is 2,333 B with an
RSA-2048 key and 3,925 B with RSA-4096, the largest secret a known connector keeps; 16 KiB leaves
four times the larger and keeps a keychain entry a secret rather than a file store. Bytes and not
characters, because a keychain stores bytes. The check lives once, in `checkedCapabilities`, and
the desktop's `credentials:set` channel applies the same constant, so the plugins screen cannot
store what the plugin could not. An empty value is refused as a `TypeError`: it is a `delete`
spelled wrong, and storing one would make "set" and "missing" disagree about the same key.

**The writers are optional on `HostCapabilities`** (`storeCredential`, `deleteCredential`). A host
without them answers both calls with `E_CREDENTIAL_READ_ONLY`, naming its source. **The CLI is
read-only**: its credentials are environment variables `TYTO_PLUGIN_<NAME>_<KEY>`, which are the
person's to set, and a value a plugin wrote into its own process's environment would vanish with
the process. The desktop implements both, on the keychain account it already reads,
`plugin:<name>:<key>` through `safeStorage`.

**A panel may store and forget its own plugin's declared keys**, extending ADR 0045. The
`panel:request` channel's capability gains `storeCredential` and `deleteCredential`; main answers
them with the same `checkedCapabilities`, against that plugin's manifest. A panel still reads only
what `credentials` reads, and nothing of another plugin's. No new channel: the connector's panel is
where a person pastes the key, and the panel is its plugin (ADR 0045).

**The isolation protocol is 5.** A guest's `request` gains two capabilities, which a host on 4
would refuse as unknown; a bootstrap left behind by an upgrade is refused by name at `hello`, as
ADR 0049 set out. `set` answers `null` rather than nothing, because the desktop's wire is JSON and
drops an `undefined`.

**The account prefix `signin:<plugin>:<id>` is reserved** for the tokens browser sign-in keeps
(ADR 0131, TYTO-374). `credentialAccount` always begins `plugin:`, so no `credentials:<key>` a
manifest declares can name, read, overwrite or delete a sign-in token. Nothing else is built for
it here.

## Consequences

- A connector keeps a secret a person handed it once, and forgets it on sign-out, without the
  plugins screen in the middle.
- A plugin that stores a secret must say, for the CLI, which variable to set instead: there `set`
  is refused, by design.
- The window still never reads a value back; the plugins screen still learns only whether a key is
  set.
- A value over 16 KiB needs a new ADR, not a bigger constant: the ceiling is what keeps a secret
  store from becoming a plugin's general storage, which is ADR 0130's private cache.
