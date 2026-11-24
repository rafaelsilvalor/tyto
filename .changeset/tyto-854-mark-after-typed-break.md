---
'@tyto/template-kit': minor
---

TYTO-854 (ADR 0229): inside one `|` part, a typed `\` followed by a mark starts a piece at that
level, returned by `levelsOf` as one more part marked `joined: true` and drawn by `levelStack`
as the next line of one text, with no part gap above it. Text after a `\` with no mark stays in
the piece before it, so `# Concurso ABIN \ 2027` reads as before.
