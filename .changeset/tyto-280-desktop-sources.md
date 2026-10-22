---
'@tyto/desktop': minor
'@tyto/io': minor
---

TYTO-280: the window draws images and fonts an installed plugin supplies (ADR 0117, ADR 0119). The preview fetches what it lacks when the brief is saved or opened from disk, never while you type: a half-typed `test:lo` asks nobody, and the miss says to save. A face that arrives reaches the same preview, measured. The export box fetches too; the queue never does, and draws what a save already cached. A restricted folder fetches nothing and names Workspace: Manage Trust. A failed fetch is asked once per session, and the miss says a restart or a different reference asks again. `@tyto/io`'s `sourceCache` gains `remembersFailures` and a per-call `SourceCall`, and no longer remembers a miss it was not allowed to fetch.
