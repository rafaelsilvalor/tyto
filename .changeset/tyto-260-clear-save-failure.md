---
'@tyto/desktop': patch
---

A save failure leaves the problems panel, and the status bar's count, as soon as the next save of that tab goes through; a file reported missing leaves it when the same recent entry opens again. A removal never lights the new-problems dot, and puts it out when no row is left for it to point at.
