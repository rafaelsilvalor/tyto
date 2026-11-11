# 0192 — The person supplies a sign-in's client when the manifest names none

Status: accepted · 2026-11-11 · TYTO-390 · amends ADR 0174 decision 4 · builds on ADR 0134

## Context

ADR 0174 decided that a plugin declares each browser sign-in in its manifest with the OAuth
client the provider issued: `"signin": { "<id>": { authorize, token, clientId, scopes,
clientSecret? } }`, `clientId` required. A connector that creates files in a person's own
storage (TYTO-390) is a public plugin in its own repository, and the client it would sign in
with belongs to the organisation that registered it. Writing that client into a manifest
anybody can read publishes it and ties every install to one organisation's registration
(Rafael, 2026-11-11: the company's OAuth client id must not be written in the public plugin
manifest). The provider's "desktop" clients come with a secret that is not confidential (ADR 0174
decision 4) but is still the organisation's to hand out.

The host already has a place a person puts something a plugin needs and nobody else reads: the
plugins screen's credential fields, write-only, kept in the keychain through `safeStorage`
(TYTO-187, ADR 0134).

## Decision

1. **`signin.<id>.clientId` is optional.** A manifest that declares it signs in with it, exactly
   as before. A manifest that leaves it out signs in with a client the person supplies.
2. **A `clientSecret` without a `clientId` is refused** at install, with its path
   (`signin.<id>.clientSecret`). A secret belongs to the client it was issued with; sent beside
   a client the person typed, it would belong to neither.
3. **The person types the client in the plugins screen.** Beside a sign-in whose manifest names
   no client, the row has a Client ID field, an optional Client secret field, Save and Clear.
   Sign in is disabled, and says why, until a client is set. **The fields are write-only**, as a
   credential's are: the screen learns whether a client is set and never its value.
4. **The keychain keeps it, under `signin-client:<plugin>:<id>`.** One JSON value,
   `{ clientId, clientSecret? }`, through the existing `safeStorage` store and inside its 16 KiB
   ceiling; never `settings.json`, which is a file people share. The prefix is reserved like
   `signin:`: a plugin's own accounts are `plugin:<name>:<key>`, and
   `host.credentials('signin-client:…')` and a `credentials:signin-client:…` permission are
   refused whatever the manifest declares.
5. **The manifest wins.** When the manifest declares a client, a stored one is never read for it,
   and the window cannot set one: the person never overrides a client the plugin's author fixed.
6. **Changing the client ends the sign-in.** Saving a client or clearing it deletes the
   `signin:<plugin>:<id>` entry and forgets the access token in memory, because a refresh token
   issued to one client is not a sign-in with another.
7. **Two channels, both write-only.** `signin:client` `{ plugin, id, clientId, clientSecret? }`,
   each value 1 to 512 characters, answers `{ stored: true }`; `signin:client-clear`
   `{ plugin, id }` answers `{ cleared }`. Both are rejected for a plugin or id no installed
   manifest declares and for a sign-in whose manifest names its client. `signin:list` gains
   `client: 'manifest' | 'set' | 'missing'` and never the values; `signin:start` answers
   `no-client` when there is none; `signin:changed` fires after either channel.
8. **A plugin call without a client is `E_SIGNIN_REQUIRED`**, as one nobody signed in to is:
   without a client nobody can have signed in. The CLI still answers `E_SIGNIN_UNAVAILABLE`
   (ADR 0174 decision 5); a manifest without a client installs there as anywhere.

## Consequences

- A public plugin can declare a provider's endpoints and scopes and leave the client to whoever
  installs it, so an organisation hands its client to its own people, outside the repository.
- A plugin whose manifest leaves the client out needs a host that accepts that manifest: an
  older app refuses it at install with `signin.<id>.clientId`. Such a plugin writes the
  `engine` range of the `@tyto/plugin-api` release that carries this decision.
- Removing a plugin leaves its `signin-client:` entry in the keychain, as it leaves its
  `plugin:` credentials and its `signin:` entry today; reinstalling it finds the client again.
  Forgetting a removed plugin's keychain entries is not decided here.
- The person has to obtain a client before the first sign-in. The user manual says how to create
  one with a provider whose clients are made per project, in neutral words.
