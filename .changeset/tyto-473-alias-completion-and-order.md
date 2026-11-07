---
'@tyto/editor': minor
'@tyto/desktop': patch
---

TYTO-473: the frontmatter `template:` completion marks an alias with what it stands for
(`aviso · laranja`) and lists it right after its template, as the command bar now does too.
The quick fix for `E_UNKNOWN_FORMAT` offers only a format the name's configuration allows.
New in `@tyto/editor`: `besideTheirTemplates`, `templateAliasDetail` and `BriefAnalysis`'s
optional `aliases` and `formats`.
