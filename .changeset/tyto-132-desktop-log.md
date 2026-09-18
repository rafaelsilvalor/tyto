---
'@tyto/desktop': minor
---

TYTO-132 — the app writes down what broke, so a beta report is not somebody's memory.

The desktop wrote no log at all. A render that threw, a preview that never answered and a save
that failed each left the process with nothing on disk, so a tester who hit something could only
describe it afterwards. There is now a rolling file in `userData/logs/`, a line per failure
naming what broke, when, in which version and on which platform, and a Help menu item that opens
the folder — a person reaches it without being told a path.

Four things now write to it: an uncaught exception or unhandled rejection in main, an IPC handler
that rejects, an export whose render died, and a failure in the window (through a new `log:write`
channel). The plugin host's own log, which until now dropped everything, goes to the same file —
so a built-in that fails to activate stops vanishing.

**It stays on the machine.** Nothing is sent anywhere, and that is not a switch somebody turned
off: ADR 0011 plus a dependency list with no network client in it leaves nowhere for it to go.
Anything that phones home needs an ADR first. The file also carries no brief text and no file
contents, enforced by length caps on the channel rather than by the discipline of the call sites.

Two consequences worth knowing: the file is capped at half a megabyte across two generations, so
the oldest entries are dropped rather than archived; and Electron's own crash box for an uncaught
exception in main is replaced by a log line, because installing a listener takes that over.
