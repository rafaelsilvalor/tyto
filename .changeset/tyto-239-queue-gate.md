---
'@tyto/desktop': patch
---

TYTO-239: the queue panel no longer reads its inbox while it moves a finished task to `done/`. On Windows that read held the task's brief open and the move failed with `EPERM`; a short retry hid it, and now the queue does not race itself at all. The retry stays for locks held from outside Tyto.
