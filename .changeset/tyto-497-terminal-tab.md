---
'@tyto/desktop': minor
---

The desktop app has a Terminal tab after Commands (TYTO-497, ADR 0164): **Ctrl+Shift+`** or **Terminal: New Terminal** opens your own shell inside the window, in the open folder. Several terminals show as small tabs at the right of the strip. A terminal follows the window's colours, in light and dark, and its code font. Copy and paste follow each platform's terminal keys, a paste of more than one line asks first, and the window's own keys, such as **Ctrl+K**, still work from inside a terminal. A restricted folder says so in the tab, with the trust action beside it. Every push from main to the window now checks first that the window is still there, which ends a crash on quit. The user manual has a Terminal page in both editions.
