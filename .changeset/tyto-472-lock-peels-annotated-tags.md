---
'@tyto/io': patch
---

A plugin file pinned to an annotated tag locks the commit the tag points at, not the tag object (TYTO-472, ADR 0151). A lock an earlier version wrote with a tag object's id keeps loading and is rewritten to the commit on the next sync that can reach the repository; nothing is reported as a moved ref.
