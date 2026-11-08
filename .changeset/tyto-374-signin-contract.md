---
'@tyto/core': minor
'@tyto/plugin-api': minor
---

A plugin may declare a browser sign-in and ask the host for its access token (TYTO-374,
ADR 0174). The manifest gains `signin: { <id>: { authorize, token, clientId, scopes,
clientSecret? } }`, each entry paired with a `signin:<id>` permission; endpoints are `https`,
or `http` on `127.0.0.1` and `localhost` only, and `clientSecret` is documented as not a
secret. `host.signin.accessToken(id)` answers a token through the optional
`HostCapabilities.signinAccessToken` port: an undeclared id is `E_PERMISSION`, nobody signed in
is `E_SIGNIN_REQUIRED`, and a host without the port, as the CLI, is `E_SIGNIN_UNAVAILABLE`.
`host.credentials` refuses every key beginning `signin:`. `RPC_PROTOCOL_VERSION` is 18, and
`testPlugin` takes `signins` and offers `signOut`. `@tyto/core` gains the two codes. No host
runs a sign-in yet.
