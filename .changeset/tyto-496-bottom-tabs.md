---
'@tyto/desktop': minor
---

**The bottom area is one strip of tabs, as in VS Code** (TYTO-496, ADR 0163): Problems, with its count, Commands, and Project or a plugin's panel when they are open, one shown at a time. The tab in front is remembered, the area keeps one height whichever tab is in front, and its × hides the whole area. The command panel has no input box any more: its prompt is the last line of its output, with nothing drawn around what is typed. Its sessions show as small tabs only when there is more than one, Stop shows only while something runs, and no line separates the panel's parts. Copy is gone from its actions: a selection copies.
