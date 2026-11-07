---
'@tyto/desktop': patch
'@tyto/editor': minor
---

A folded recipe table stays folded when a step is inserted above it (TYTO-451). The notebook
keeps each fold by the start of its cell's line and maps it through every edit, so the fold
follows its line instead of an index that now names another cell; deleting the line drops its
fold. `@tyto/editor` adds `mapLineStarts` and `cellOutputLineStart`, and `onChange` listeners
receive a third argument, the edit: its changes and the text before and after them.
