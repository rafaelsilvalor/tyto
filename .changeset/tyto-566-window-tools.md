---
'@tyto/command-line': minor
'@tyto/desktop': minor
---

TYTO-566: the window's tools for agents (ADR 0180). Served by a window, `tyto mcp` adds
`brief_in_front` and `selection` in any folder, and `open_file` and `show_format` in a trusted
one, asked first in a box unless `agentsWindowActions` is `allow`. `agentsListen` turns the
window's endpoint off and on, live. `serveAgent` takes the window as a `WindowPort`.
