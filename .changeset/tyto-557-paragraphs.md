---
'@tyto/core': minor
'@tyto/brief-lang': minor
'@tyto/export-html': minor
'@tyto/export-svg': minor
'@tyto/template-kit': minor
---

TYTO-557: a blank line between two lines of text makes a paragraph, and the template sets its
space (ADR 0205, superseding ADR 0087 on this point). `parseBrief` marks the `Break` at the
boundary `paragraph: true`; several blank lines are one, and one at the start or the end of a
block, or a comment line, makes none. `runsOf` takes `paragraphSpacing` (px) and the Scene's
`LineBreak` gains an optional `space`; template-kit's `TextStyle` passes `paragraphSpacing`
through. Layout counts the space in the height and scales it with a shrink; `export-html` draws
it as a block that tall after the `<br>`, `export-svg` moves the next baseline down. The
default is 0, which writes the plain break: a template that declares nothing draws exactly as
before. Format Brief keeps a blank line under a head with text of its own, and `writeBrief`
keeps a run of blank lines between two lines of a value as one.
