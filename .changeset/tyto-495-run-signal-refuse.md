---
'@tyto/command-line': minor
---

`run(argv, environment, signal)` stops a run part of the way through: `render` between frames, `watch` between sweeps (ADR 0159 decision 6). `environment.refuse` is asked before every command with its path, arguments and parsed options; a sentence refuses the command with exit 1. `environment.shellRefusal` makes a run fail at any step that would start a shell, which today is `npm` on Windows, whichever command reached it. `commandTree` describes the command tree as data. A terminal sets none of these, so `tyto` behaves as before.
