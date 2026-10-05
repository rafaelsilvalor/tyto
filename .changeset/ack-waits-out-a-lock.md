---
'@tyto/io': patch
---

TYTO-198: `fsInbox`'s `ack` tries the rename again while Windows says the task folder is held
(`EPERM`, `EACCES`, `EBUSY`) — six attempts, 310 ms of waiting at most — and then fails as
before. A file read inside the folder during the rename, by the queue's own listing or by an
antivirus, no longer fails a task that rendered cleanly. `ENOENT` is never retried.
