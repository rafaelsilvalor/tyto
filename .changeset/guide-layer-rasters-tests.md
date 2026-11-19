---
---

Tests in `@tyto/command-line` and `@tyto/desktop` read an exporter's answer, which may now
be bytes (ADR 0221), and carry a byte answer across the desktop's plugin wire; nothing ships.
