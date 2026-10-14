---
'@tyto/desktop': minor
---

TYTO-286: the editor groups come back after a restart — the same splits, the same tabs in each group, the same group focused, and each group's cursor where you left it, even for one brief open in two groups. Three new commands on the View menu and in the command bar: focus the next or previous group (they wrap at the ends, as Ctrl+Alt+Left/Right now do), move the tab in front to the next group (with one group, it opens a split to the right for it), and close the group, which closes its tabs as Ctrl+W does and asks before dropping unsaved text. A session written by this version still opens in an older one, as one group with every tab.
