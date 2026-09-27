---
'@tyto/desktop': minor
---

TYTO-45: the desktop has a local queue panel (File > Show the local queue). It works over a
folder laid out as `tyto watch <folder>` lays it out and lists each task folder in `inbox/` and
`done/` as pending, rendering, done or error. A failed task shows its diagnostics. Each task can
be run or retried, its brief opened in the editor to fix it, and its `out/` folder opened. With
auto-run on (off by default), a folder dropped into `inbox/` renders on its own. A failed task
is never re-run without being asked. Use one consumer per folder: a task another program moved
first is reported on the task, not as a crash.
