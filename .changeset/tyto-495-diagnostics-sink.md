---
'@tyto/command-line': minor
---

`environment.diagnostics` receives every diagnostic a run prints, already placed at the file, line and column the printed text names (ADR 0159 decision 7). The sink belongs to the run, so two runs at once each receive only their own diagnostics. What a command prints does not change: across the package's suite, the 113 printed outputs were byte-identical before and after.
