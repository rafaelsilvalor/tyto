---
'@tyto/brief-lang': minor
---

TYTO-330 (ADR 0109): a `\` ending a line of a directive body, with another line of its indented block after it, no longer adds an empty line. Every block line already starts a new line, so `parseBrief` drops that `\` — and the spaces in front of it — and reports the new warning `W_REDUNDANT_BREAK` on it. **A brief that had one renders one empty line shorter, and shows a warning where it used to compile silently.** `\\` there still leaves one empty line, with one warning. A `\` in the middle of a line, at the end of an inline body with no block, or on the last line of a block is unchanged.
