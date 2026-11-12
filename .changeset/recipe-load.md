---
'@tyto/desktop': minor
---

TYTO-402, ADR 0176 decision 7: Load recipe, from the Explorer's menu and the command bar. Main
asks for a `.recipe` anywhere on disk and copies it into the chosen folder with the recipes its
`run` lines include and the data and vocabulary files it names (`referencesOf`), then opens the
copy. Nothing is overwritten: when any of those files is already there, nothing is copied and
each one is named. A reference that leaves the source folder (`../`), a link that leads out of
it, a malformed reference, a missing file and a path under `.tyto` are reported above the tree
and never read. The new `recipe:load` channel takes an explorer id, never a path.
