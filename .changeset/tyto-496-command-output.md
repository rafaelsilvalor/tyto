---
'@tyto/desktop': patch
---

The status bar's problem count includes the rows a `tyto` command run in the window reported, and its errors count as errors. A command's place in a Problems row reads relative to the open folder, takes at most half of the row, and is cut from the start of its folder, so the file and its line always show. The command panel's parts arrive ahead of it, unused until TYTO-496's panel lands: the command line split into words, a command's colours, the history per folder, the links in its output, and its sessions.
