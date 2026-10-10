---
'@tyto/editor': minor
'@tyto/desktop': minor
---

TYTO-96 (ADR 0075): the window gets one visual language, Zed's One Light and One Dark, in one token file. `@tyto/editor`'s palette is now a list of `var(--tyto-…)` custom properties the host defines instead of two sets of literal colours, exported as `themeTokens`; a host that defines none gets an uncoloured editor. Its selection colour now wins over CodeMirror's base rule while the editor is focused, and `restore` brings a stored tab up to the theme the editor is in now. The desktop defines every token in `src/renderer/tokens.css`, draws in the bundled Source Sans 3, follows the system's light or dark live in the window and in every editor, and fails `pnpm check` on a literal colour, radius, size or font anywhere else in the renderer.
