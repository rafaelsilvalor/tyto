# 0131 — Browser sign-in is a host service, and the plugin only receives the token

Status: accepted · 2026-10-24 · TYTO-368 · builds on ADR 0049, ADR 0127 and ADR 0130

## Context

Buraqueira creates Drive folders and spreadsheets with the maintainer's own Google sign-in,
because a service account owns no storage in somebody's Drive. The full replacement of
Buraqueira, chosen on 2026-10-24, therefore needs a browser sign-in inside this epic, for the
maintainer and for each designer.

An OAuth sign-in for an installed desktop app opens the system browser and receives the answer
on a loopback port (Jacurutu's `adapter-drive/src/auth.ts` does this). A plugin cannot listen on
a port: its process runs under the runtime permission model (ADR 0049), and opening a port
there would be a hole in it.

## Decision

1. **The host runs the flow.** OAuth 2.0 authorization code with PKCE, a loopback redirect on
   `127.0.0.1` with a port chosen at that moment, the system browser opened by the host.
2. **The plugin declares the provider in its manifest**: authorize URL, token URL, client id
   and scopes, under a `signin:<id>` permission the person approves at install. Tyto keeps no
   list of providers.
3. **The refresh token goes to the keychain** under the plugin's account and never reaches the
   plugin. The plugin asks the host for an access token and receives one, refreshed by the
   host when it has expired.
4. **The window shows who is signed in and offers sign-out**, per plugin. Signing out deletes
   the refresh token.

## Consequences

- No plugin ever holds a long-lived Google credential, and no plugin opens a port.
- An installed-app client id is not a secret, so it can ship in the plugin's manifest. Whether
  the company's Google admin must approve the client for the team is not measured.
- Jira keeps its API token for now, chosen on 2026-10-24. The same service can serve Jira's
  OAuth later without a change here.
