---
'@tyto/brief-lang': minor
---

TYTO-297 (ADR 0096): spaces and tabs at the end of a line of text no longer mean anything. `parseBrief` trims them from the inline body and every line of a block, so **a brief that had trailing spaces renders slightly differently: a centred line such as `Profª. Mara Rebeiro  ` goes back to the centre.** New `formatBrief` and `formatBriefEdits`: the brief rewritten into its canonical shape — body lines indented by `indentUnit` spaces, no trailing spaces, one blank line where there were several, none between a head and its first body line, a final line ending in the file's own style — changing nothing inside a line and nothing the brief compiles to. A brief with a syntax error is refused with its `E_SYNTAX` diagnostics.
