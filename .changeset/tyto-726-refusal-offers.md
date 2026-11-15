---
'@tyto/desktop': minor
---

TYTO-726: a command the panel refuses offers the window's own way in a native box that names
what it acts on: `--trust` offers to trust the open folder (saved, as Workspace: Manage Trust
does) and then runs the command without it; `signin` and `signout` sign in or out as the
plugins screen does; `recipe run --apply` opens the recipe's notebook, applying nothing; and
`watch` on the queue folder turns Render automatically off and watches. Cancel is the default;
`tyto mcp` stays refused (ADR 0159 note of 2026-11-15).
