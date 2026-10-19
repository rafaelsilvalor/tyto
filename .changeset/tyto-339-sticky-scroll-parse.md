---
'@tyto/editor': patch
---

Sticky scroll draws its rows again when the background parse finishes (TYTO-339). A template pasted and scrolled at once could leave the pinned rows missing until the next scroll: the parse that found the close tags landed in a transaction with nothing else in it, and the layer did not measure again.
