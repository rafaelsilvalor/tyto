---
'@tyto/core': minor
---

A rich-text slot may declare `frontmatterMarks: true` in the manifest when its template draws
`**…**` and `{key:value}…{/}` in a frontmatter value itself (through template-kit's
`richTextOfPlain`). On such a slot `W_MARKUP_IN_FRONTMATTER` no longer calls that subset
literal text; any other markup still warns, and every slot that does not declare it warns as
before (TYTO-622).
