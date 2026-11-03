---
'@tyto/core': minor
'@tyto/plugin-api': minor
'@tyto/house-style': minor
---

A template says which of its files is missing (TYTO-502). `@tyto/core` adds
`W_TEMPLATE_FILE_MISSING` to the closed list a template may report, naming the artwork, the
format, the template and the path it asked `context.files` for. `@tyto/house-style` gains
`requiredImage`, and the product banner reports a format whose `assets/bg-<format>.png` is
missing instead of drawing it on plain paper in silence. The report carries the path, so the
plugin RPC protocol is 15.
