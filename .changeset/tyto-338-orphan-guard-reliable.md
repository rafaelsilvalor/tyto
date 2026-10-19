---
---

Test-only (TYTO-338): the desktop end-to-end harness no longer loses every candidate on Linux when one process ends mid-scan, writes an app down before it starts, and `orphan-guard` leaves neither its bystander nor its nested app behind when its own worker dies. Nothing ships.
