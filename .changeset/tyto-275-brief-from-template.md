---
'@tyto/editor': minor
'@tyto/desktop': minor
---

TYTO-275: a new brief from a template, built from its manifest. `@tyto/editor` exports `briefSkeleton`, which turns a manifest's required slots — and a repeated slot with a minimum of one — into a CodeMirror snippet whose fields Tab walks, `skeletonText` and `insertBriefSkeleton`; an enum value that is selected now completes to every value. The desktop's "New brief from template…" (Ctrl+K and the File menu) lists every template with its folder and description and opens the chosen one's skeleton in a new tab, and choosing a template in the picker on an empty brief writes the same skeleton. `templates:list` carries each template's slots and its folder.
