---
'@tyto/desktop': patch
---

TYTO-654: the explorer e2e waits for a click's open to settle before it presses F2, so a late
focus into the editor no longer closes the rename field on a loaded runner. Test only.
