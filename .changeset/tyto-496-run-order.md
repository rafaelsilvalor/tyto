---
'@tyto/desktop': minor
---

The command panel shows each run as a block (TYTO-496): a header with the command, its paths cut to file names, the time it started and how it ended (✓ 0, ✗ 1, stopped, not run), over what it printed, with a gap before the next. Problems' command sections take the same header. Two settings lay the runs out, live: `commandsOrder` (`"newestLast"`, the default, or `"newestFirst"`, which puts the prompt first; Problems' sections follow it) and `commandsFoldOlderRuns` (`false` by default; `true` folds every run but the newest to its header, a click opens one, and Ctrl+F opens a folded run that holds a match).
