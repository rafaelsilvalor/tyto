---
'@tyto/desktop': patch
---

TYTO-259: the line under the preview that said "Problems: N" or "No problems" is gone. It counted only the brief's problems while the status bar's problems button counts every row of the Problems panel, so the window could show two different numbers at once; the status bar's count is now the only one.
