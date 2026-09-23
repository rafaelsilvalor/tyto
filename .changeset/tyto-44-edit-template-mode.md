---
'@tyto/desktop': minor
'@tyto/template-lang': minor
'@tyto/editor': minor
'@tyto/cli': minor
---

TYTO-44 — the desktop app has a template mode. _File ▸ Edit template…_ opens a markup template
folder with `manifest.yaml` and `template.html` in tabs of their own, one of the folder's
`examples/*.brief` as the sample, and every format the manifest declares drawn side by side
from the unsaved buffers. Saving writes both files and reads the template folders again, and
every open brief is compiled again; a manifest that does not parse is not written, and the
diagnostic that stopped it is shown. A folder whose layout is a `template.ts` is refused with a
sentence saying why (ADR 0007). _File ▸ New template…_ writes the same scaffold as
`tyto template new`, into the template folder in force.

The scaffold moved to `@tyto/template-lang` (`scaffoldTemplate`, `isTemplateName`) so both hosts
write one text. It now also writes `examples/<name>.brief`, and its title uses "Source Sans 3"
instead of "Inter": no install of Tyto has Inter, so every scaffolded template failed its first
render with `E_EXPORT_FONT_UNRESOLVED`. `@tyto/editor` takes `language: 'plain'` for a buffer
with no grammar.
