---
'@tyto/desktop': patch
---

TYTO-285: nothing changes when you press Ctrl+Enter — it still adds a line, as it always did. What is gone is the built-in binding behind it to a render command the window never had, and a test now fails if any built-in key names a command the window does not register.
