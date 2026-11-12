---
'@tyto/desktop': minor
---

TYTO-646: a browser sign-in still waiting can be cancelled from the plugins screen. The waiting
line has Cancel, which reaches main through the new `signin:cancel` channel: the loopback
listener closes at once, the attempt answers `cancelled` with nothing stored, and Sign in works
again without waiting out the five-minute timeout. A callback arriving afterwards gets no
answer.
