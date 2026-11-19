---
'@tyto/plugin-api': minor
'@tyto/recipe': minor
'@tyto/io': minor
'@tyto/command-line': minor
'@tyto/cli': minor
'@tyto/desktop': minor
---

A plugin action can finish a long write within one Apply (TYTO-791, ADR 0216). An `apply`
answer may say an operation should `continue`, with a `progress` line of at most 80
characters; the host asks again for those operations within the same Apply, up to 120 more
calls per batch, and a cancel read between calls leaves what was in progress `failed` as
unfinished. The plugin protocol moves from 27 to 28; a plugin built before it runs
unchanged. The desktop shows the progress under the plan with Cancel beside it, and
`tyto recipe run --apply` prints it on stderr and stops at the first Ctrl+C, exiting 1.
