---
'@tyto/command-line': patch
'@tyto/desktop': patch
---

TYTO-656: `tyto mcp --window` tries the next window when nobody listens at a record's endpoint,
instead of failing. The desktop's packaged suite connects to its own window's record by pid, and
the RunAsNode probe gets a `TYTO_HOME` of its own so it leaves no orphan record behind.
