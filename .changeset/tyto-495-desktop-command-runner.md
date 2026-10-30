---
'@tyto/desktop': minor
---

Main runs `tyto` commands for the window (TYTO-495, ADR 0159). New channels: `cli:run` takes the words after `tyto` and answers with a run id, `cli:cancel` stops a run, and `cli:commands` describes the command tree. New events: `cli:output` carries the text, and `cli:state` carries running, waiting, finished with its exit code, or cancelled. A command uses the window's rasterizer, plugin launcher, `TYTO_HOME` and open folder. It asks its questions in a native box whose default is no. Three things are refused: `--trust`, an npm `plugin install` on Windows, and `watch` on the auto-run queue's folder. No panel shows any of this yet; TYTO-496 adds one.
