---
'@tyto/editor': minor
---

TYTO-258: CodeMirror's own search panel, completion list, lint tooltip and diagnostic underlines are painted from the host's tokens, like the buffer. `themeTokens` grows by the roles they read — `surface-raised`, `hairline`, `border`, `focus-ring`, `hover`, `button-on`, `error`, `warning`, `info`, the type size, radius and widths among them — so a host must define those too. The underline under a diagnostic is a wavy text decoration in the severity's token instead of CodeMirror's drawn image, and a search match is outlined rather than filled.
