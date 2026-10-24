---
'@tyto/io': patch
'@tyto/desktop': patch
---

TYTO-350: one JSONC reader for the project file and the settings file. `@tyto/io` exports `readJsoncText`, the reader `readProjectText` already used (parse, recovery around a syntax error, the range of every key and of every syntax error), now taking the file's own syntax code and its "not an object" problem. The desktop's `settings.json` is read through it and keeps its own in-place writer. Nothing a person sees changes: the same codes, messages and ranges as before.
