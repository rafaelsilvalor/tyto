---
'@tyto/plugin-api': minor
'@tyto/io': minor
'@tyto/desktop': patch
---

Browser sign-in's host side moves out of the desktop's main so a second host can compose it
(TYTO-683): the PKCE flow, the token endpoint and the sign-in service are exported by
`@tyto/plugin-api`, with the loopback listener as a port (`CallbackListen`), and its adapter
`listenForCallback` by `@tyto/io`. The desktop composes them as before; nothing a person sees
changes.
