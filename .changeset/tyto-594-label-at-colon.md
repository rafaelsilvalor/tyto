---
'@tyto/template-kit': minor
---

TYTO-594: `labelOf` and `labelOfText` split a line into its label, what comes before its first `:`, and its text. The separator, the longest label and the separators that do not count (a time, a URL) are the caller's data, `**…**` is kept on both sides, and the template styles the label.
