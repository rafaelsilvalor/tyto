---
'@tyto/command-line': minor
---

New package: the `tyto` command tree, moved out of `apps/cli` so the desktop can run the same commands in its main process (ADR 0159). `CliEnvironment` gains `launch`, the port that starts an installed plugin's process; the package chooses no launcher and no rasterizer on an app's behalf.
