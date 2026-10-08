---
'@tyto/io': major
'@tyto/core': minor
'@tyto/cli': patch
'@tyto/desktop': patch
---

A folder sitting where Tyto writes a file is now an error diagnostic instead of a crash
(TYTO-243, the mirror of TYTO-129). The copied brief, `template.txt`, `result.json`, an image
in `assets/` and an artwork file are all covered, under `--folder` and, for `result.json` and
the artwork, under `--out` too. The new code `E_OUTPUT_FILE_BLOCKED` names the path. A file
held open by another program, a folder without permission and a full disk still throw.

**Breaking for `@tyto/io` callers:** `TaskOutput.finish` and `DeliveryOutput.describeTemplate`
now return `Promise<Diagnostics>`. Report what they answer: `finish`'s diagnostics cannot be in
the `result.json` that was not written, and `describeTemplate`'s belong in the one `finish`
writes.

`tyto render --folder` exits 1 with that diagnostic, where it used to exit 2 with a stack
trace for every file but the artwork. The artwork was already exit 1, and its `E_OUTPUT_WRITE`
now carries the same sentence instead of the raw `EPERM … rename` text. The desktop export box
shows the diagnostic under "Finished with problems" instead of an `EPERM` failure.
