---
'@tyto/editor': minor
'@tyto/desktop': minor
---

TYTO-296 (ADR 0095): "Go to Block…" (Ctrl+Shift+O, in both input modes) lists the brief's blocks in the command bar — the frontmatter as "cabeçalho"/"header", every directive as `::lamina 2` with its first words beside it — and moving through the list previews each one; Enter leaves the caret on it and Escape puts the caret and scroll back. Brief-only and on the View menu, which now greys what the tab in front cannot use. `@tyto/editor` exports `briefBlocks`, `blocksOf` and `blockAt`: the blocks read from the syntax tree, numbered only for a slot the manifest says repeats, and remembered per tree.
