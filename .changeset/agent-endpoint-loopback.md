---
'@tyto/command-line': minor
'@tyto/desktop': patch
---

On Windows the window serves agents on loopback TCP (`127.0.0.1`) instead of a named pipe, which
accepted clients through the SMB redirector, and keeps `TYTO_HOME/windows` to its owner and
SYSTEM (ADR 0189). The relay connects to no `tcp://` endpoint off loopback. `endpointFor` is
replaced by `listenTargetFor`, `loopbackEndpoint`, `connectTargetOf` and `connectToEndpoint`.
