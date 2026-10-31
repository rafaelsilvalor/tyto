---
'@tyto/desktop': minor
---

**The command panel** (TYTO-496, ADR 0159): `tyto` commands typed into the window, in the bottom area beside Problems, opened and closed with `` Ctrl+` `` (Show or hide: Commands). Each session is a tab with one run, a Stop, and how the run ended: the exit code, or stopped. The input line splits on spaces and keeps a quoted word whole, refusing an unclosed quote; ↑/↓ walk the history and Ctrl+R searches it, kept per workspace folder. The output keeps a command's colours, links a place it printed to the file at that line, finds with Ctrl+F, copies and clears. After a `trust` command the window reads the folder's trust again. The keyboard and command references list the new key.
