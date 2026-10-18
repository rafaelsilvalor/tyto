---
'@tyto/editor': patch
---

TYTO-272: the completion list reads `--tyto-code-size` itself instead of inheriting the editor's size, so a host can give it a size of its own. With no host value set it is the size it was.
