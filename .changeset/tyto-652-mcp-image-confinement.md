---
'@tyto/command-line': patch
---

TYTO-652: `tyto mcp` draws an image a brief cites only when its real path is inside the folder,
its workspace or the workspace's asset folders, so a link inside the folder no longer reads a
file outside it; an escape answers as a missing file. `render_preview` fetches from a plugin or
Google Fonts only in a trusted workspace (ADR 0179 amendment).
