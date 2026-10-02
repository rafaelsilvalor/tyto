---
'@tyto/desktop': patch
---

The preview panel no longer shows a story cut at 1080 px. A fresh preview frame kept the first of two documents when the second arrived before the first had loaded, so a story clicked right after a brief opened showed the square format's document, with checkerboard below it. The panel now loads one document at a time and applies the newest one when the previous load ends (TYTO-219).
