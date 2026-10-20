---
'@tyto/pipeline': minor
'@tyto/io': major
'@tyto/core': minor
---

An artwork file another program holds open is now an internal failure worth retrying, not an error about the brief (TYTO-245, ADR 0108).

**`ArtifactSink.write` returns `Promise<Diagnostics>`** (`@tyto/pipeline`), and so does `TaskOutput.write` (`@tyto/io`). A sink answers what it can explain — `E_OUTPUT_FILE_BLOCKED` for a folder at the artwork's name — and `runJob` fails that one frame with it and writes the others. A rejection is no longer turned into `E_OUTPUT_WRITE`: `runJob` starts no further frame, lets the ones in flight settle and rejects with the sink's cause. A sink of your own returns `[]` where it used to return nothing.

`@tyto/core`: `E_OUTPUT_WRITE` is no longer produced and stays in the catalogue, documented as retired by ADR 0108. `E_OUTPUT_FILE_BLOCKED` is no longer fatal: on an artwork it costs that file, and the report that names it survives.
