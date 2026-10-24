---
'@tyto/desktop': minor
---

TYTO-333: vim mode is remembered. A new `vimMode` setting (boolean, default `false`) is read at start, so the window opens with vim on when it is `true`. "Editor: turn vim mode on or off" (`editor.toggleVim`) writes it to `settings.json` in place, comments kept, so the choice survives a restart; a file that does not parse refuses the write and vim goes back to what the setting says. A hand edit of the setting turns vim on or off in an open window when the file is saved.
