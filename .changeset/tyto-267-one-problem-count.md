---
'@tyto/desktop': patch
---

TYTO-267: the problems panel's heading no longer shows its own problem count. With the panel open the same number used to appear twice — in the heading and on the status bar's problems button; now only the status bar shows it. The button's screen-reader label now includes the count, since the heading's count was the one a screen reader could read.
