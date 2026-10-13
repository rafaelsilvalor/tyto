---
'@tyto/editor': minor
---

TYTO-277: snippets in the brief editor. `snippetTemplate(body)` translates a VS Code snippet body into a CodeMirror `snippet()` template — `$1`, `${1:default}`, `$0`, escapes, every literal brace escaped — and refuses what it cannot say (variables, transforms, nested fields) by name; a choice becomes its first option. `briefSnippets(get)` offers them in completion on a word that starts its line, outside the frontmatter, and `snippetsSlashSource` lists them in the "/" menu; a snippet with `forTemplate` is offered only while the brief names that template. `tabThroughCompletions()` makes Tab and Shift+Tab step through an open completion list, falling through to a snippet's fields or to indenting when none is open. The "/" menu's sections now keep the order the host gave its sources.
