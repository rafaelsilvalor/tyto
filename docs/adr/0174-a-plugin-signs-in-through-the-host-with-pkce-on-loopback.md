# 0174 — A plugin signs in through the host, with PKCE on a loopback port

Status: accepted · 2026-11-08 · TYTO-374 · builds on ADR 0041, ADR 0042, ADR 0049, ADR 0127,
ADR 0131 and ADR 0134

## Context

ADR 0131 decided that browser sign-in is a host service: the host runs OAuth 2.0 with PKCE on a
loopback redirect, the plugin declares its provider under a `signin:<id>` permission, the refresh
token goes to the keychain and never reaches the plugin, and the window shows who is signed in.
It left open how each of those is spelled: the manifest's shape, which URLs a manifest may name,
what a plugin calls and what it gets back, what a host that cannot open a browser answers, how
the flow is bounded, and what the keychain holds.

A connector that creates folders and spreadsheets in somebody's own storage needs that person's
sign-in; a service account owns no storage there. A plugin cannot listen on a port (ADR 0049),
and Tyto knows no provider (ADR 0127), so the host must run a generic flow from what the plugin
declares.

TYTO-374 lands in three pull requests: this record, the contract in `@tyto/plugin-api` and the
two diagnostics in `@tyto/core`; then the desktop's sign-in service in main, with unit tests;
then the plugins screen, the user manual and an end-to-end test against a fake provider.

## Decision

1. **The manifest declares each provider under `signin`, keyed by id.**
   `"signin": { "<id>": { "authorize", "token", "clientId", "scopes": [], "clientSecret"? } }`.
   An id is lowercase letters, digits and hyphens. The object is strict, so a stray key —
   `refreshToken` — is refused with its path. Scopes are non-empty strings, no repeats, and may
   be an empty list for a provider whose default scope is enough.
2. **The permission and the entry come in pairs.** Each `signin.<id>` needs the permission
   `signin:<id>`, and each `signin:<id>` permission needs its entry; either alone is refused at
   install with its field path. The permission is what the person approves and what
   `checkedCapabilities` reads; the entry is what the host runs. A `credentials:signin:…`
   permission is refused, because it would name a sign-in's tokens, which only the host holds.
3. **Endpoints are `https`, except on this machine.** `authorize` and `token` must be absolute
   `https` URLs. Plain `http` is allowed only on `127.0.0.1` and `localhost`, for a test provider;
   any other `http` host, any other scheme, a user or password in the URL and a fragment (RFC 6749
   section 3.1) are refused. The URL is parsed, not matched by prefix, so
   `http://127.0.0.1.example.com` is refused.
4. **`clientSecret` is optional and is not a secret.** An installed app cannot keep one. Google
   issues its desktop clients a "client secret" that its own documentation calls
   non-confidential and still asks for at the token endpoint, so the manifest may carry it; the
   host sends it only when declared. Anybody who reads the manifest reads it, so a provider that
   treats its secret as confidential cannot be declared this way.
5. **The plugin calls `host.signin.accessToken(id)` and gets a string.** Behind it is one port,
   `HostCapabilities.signinAccessToken(plugin, id)`, and the check is the same
   `checkedCapabilities` that guards `fetch` and `credentials`, on the host's side:
   - an id without `signin:<id>` is `E_PERMISSION`, and the port is never asked;
   - a declared id nobody signed in to is `E_SIGNIN_REQUIRED`, whose message says to sign in from
     the plugins screen;
   - a host without the port is `E_SIGNIN_UNAVAILABLE`. **The CLI is such a host**: it has no
     window to sign in from, so it composes no port and answers this code without code of its
     own;
   - an adapter that answers anything but a non-empty string — its whole token record, say — is
     refused as a `TypeError`, so a token record cannot reach the plugin by mistake.
6. **A plugin call never opens a browser.** Only a person starts a sign-in, from the host's own
   screen. A plugin that wants one tells the person through its own surfaces, with the
   `E_SIGNIN_REQUIRED` it was answered; a browser that opens because a recipe ran is the
   prompt a person learns to click through.
7. **The wire carries the access token and nothing else.** Protocol 18 adds one request,
   `signinAccessToken`, whose argument is the id and whose answer is a non-empty string. No
   message in either direction carries a refresh token. The plugin's own `host.credentials` on a
   key that begins with `signin:` is `E_PERMISSION` whatever it declares, in
   `checkedCapabilities`, beside the desktop's account prefix that already keeps
   `plugin:<name>:<key>` away from `signin:<plugin>:<id>` (ADR 0134).
8. **The host's flow, in main.** The desktop runs it in its main process:
   - PKCE with `S256`, the verifier from WebCrypto's random bytes, and a random `state` checked on
     the callback; a callback whose `state` does not match is refused and ends the attempt;
   - the redirect is a `node:http` listener bound to `127.0.0.1` on port 0, so the system picks a
     free port at that moment; it accepts one callback, answers a static page, closes, and gives
     up after five minutes;
   - the browser is the system's, opened by the host; the code is exchanged at the declared
     `token` endpoint through `net.fetch`, so the system's proxy applies;
   - the keychain holds JSON `{ refresh, label, since }` under the account
     `signin:<plugin>:<id>` through the existing `safeStorage` store, inside its 16 KiB ceiling
     (ADR 0134). **Only the refresh token is stored**; the access token lives in main's memory,
     is refreshed when it has expired, and is lost when the app quits;
   - a refresh answered `invalid_grant` deletes the entry, so the plugin is answered
     `E_SIGNIN_REQUIRED` rather than a token that will not work;
   - `label` is the email or name claim of the `id_token` when the provider sends one, shown only
     to say who is signed in and never trusted for anything else, and "Signed in" otherwise;
   - signing out deletes the entry and forgets the access token.
9. **The testing entry signs in by option** (ADR 0150). `testPlugin({ signins: { <id>: token } })`
   answers those access tokens; a declared id left out answers `E_SIGNIN_REQUIRED`, and
   `harness.signOut(id)` forgets one mid-test, so a plugin's repository tests both answers
   without a browser.

## Consequences

- A plugin gains a person's own sign-in without ever holding a long-lived credential and without
  opening a port. What it holds is an access token, which expires when the provider says.
- A plugin built against protocol 17 is refused at `hello` by an app on 18, as every bump does:
  both ends ship inside the same app.
- A recipe that needs a sign-in fails in the CLI with `E_SIGNIN_UNAVAILABLE`, by design. Signing
  in from a terminal (a device-code flow, or a token handed over by the desktop) is a later
  decision, not taken here.
- The declared `clientSecret` is public by construction. A provider that issues a confidential
  secret to installed apps cannot be used until the host can hold one, which is not decided.
- The company's Google admin does not need to approve the client id for the team: measured
  with Buraqueira and Jacurutu (Rafael, 2026-11-08).
- The host sends `authorize` exactly as declared, with its own query parameters added; a provider
  that needs extra parameters (`access_type=offline`, `prompt=consent`) declares them in the URL.

## Notes

- 2026-11-08 (TYTO-374, the desktop's service): three details decision 8 left open. A token
  answer without `expires_in` is trusted for an hour, and every access token is refreshed a
  minute before its expiry. A code exchange that returns no refresh token stores nothing and
  says so, because the window would otherwise claim a sign-in that ends when the app quits.
  Two plugin calls that find the token expired share one refresh, so a provider that rotates
  refresh tokens does not refuse the second.
- 2026-11-08 (TYTO-374, the plugins screen): **the page the browser lands on after the callback
  is in the window's language**, not English only. Main already knows the language the window
  last chose, a person reads that page right after clicking Sign in in the window, and the words
  are fixed catalogue strings (`plugins.signin.page.*`) escaped into a static page, so nothing
  from the query reaches it. The screen reaches `signin:list`, `signin:start` and `signin:out`
  and hears `signin:changed`; none carries a token. `signin:list` leaves the label out when the
  keychain holds the English default, so the window says "Signed in" in its own words.
- 2026-11-11 (TYTO-390): **decision 4 is amended by ADR 0192.** `clientId` is optional: a
  manifest that leaves it out signs in with a client the person types in the plugins screen,
  kept in the keychain under `signin-client:<plugin>:<id>`; a manifest that declares it still
  wins, and a `clientSecret` without a `clientId` is refused.
