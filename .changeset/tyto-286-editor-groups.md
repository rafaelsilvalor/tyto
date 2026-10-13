---
'@tyto/editor': minor
'@tyto/desktop': minor
---

TYTO-286: the editor splits. Ctrl+\ opens the brief in front in a second group to the right, Ctrl+Shift+\ below (also on the View menu, in the command bar, and as `:vsplit` and `:split` in vim), and Ctrl+Alt+Left/Right moves between groups. Each group has its own row of tabs on top; the strip across the whole window is gone. The same brief can be open in two groups and typed into in either, with one undo history. The status bar, the problems panel, the preview and the title follow the group you are in. For now a window with several groups reopens after a restart as one group with every tab and draft. `@tyto/editor` makes several panes over one editor (`createPane`, `followerOf`, `isFollower`) and names the view in `onUpdate` and `onChange`.
