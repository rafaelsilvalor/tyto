---
'@tyto/io': minor
'@tyto/plugin-api': patch
'@tyto/desktop': minor
---

The desktop writes briefs with `to-brief` (TYTO-380, ADR 0172). `@tyto/io` adds
`workspaceBriefPorts`, the verb's ports over a workspace folder: `stat` answers the SHA-256 of a
file's bytes (`briefDigest`), `write` lands the brief whole and creates its folder, and both
confine the real path again after following links, refuse `.tyto/` and refuse a folder that is
not trusted, asked on every call. `@tyto/plugin-api` names `ToBriefPorts` and `BriefFolder`, so
the adapter implements a port from it. The desktop's recipe runner binds the ports per run and
per Apply to the recipe's workspace and trust, with templates looked up as the preview looks up
a brief's `template:`.
