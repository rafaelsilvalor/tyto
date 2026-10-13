---
'@tyto/desktop': minor
---

TYTO-277: a snippets file, as in VS Code. "Preferences: Open Snippets (JSON)" opens `snippets.json` beside `settings.json`, created with a comment on first open; an entry is `"Name": { "prefix": "aula", "body": ["::aula ${1:titulo}", "::prof ${2:nome}"] }`, so snippets copied from VS Code can be pasted. Typing a prefix at the start of a line in a brief offers the snippet, Enter inserts it with its first field selected and Tab walks the rest; the "/" menu lists the snippets under their own heading. While a completion list is open, Tab and Shift+Tab move through it. A save applies with no restart; a bad entry is a warning in the problems panel at its line, and a file that does not parse keeps the last snippets that did. The tab comes back with the session, and the file travels with the import from the previous version.
