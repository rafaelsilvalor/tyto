---
'@tyto/editor': patch
---

TYTO-272: a binding that ends in the minus key is shown with its minus. `bindingsOf` turned every `-` into the separator, so `Mod--` (Zoom out) read `Ctrl++` in the command bar and `Mod-Shift--` read `Ctrl+Shift++`; it now reads `Ctrl+-` and `Ctrl+Shift+-`, and `⌘-` on macOS.
