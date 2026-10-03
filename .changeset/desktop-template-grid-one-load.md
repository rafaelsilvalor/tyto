---
'@tyto/desktop': patch
---

The template mode's preview grid no longer keeps an old sample. A fresh cell whose sample changed before its first load kept the first one, the same race the preview panel had in TYTO-219. Both now go through one rule that loads one document at a time and applies the newest when the previous load ends (TYTO-220).
