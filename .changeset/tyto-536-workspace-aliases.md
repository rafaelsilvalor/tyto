---
'@tyto/desktop': minor
---

`alias --workspace name='line'` and `unalias --workspace name` write the command panel's aliases
into the open folder's own `.tyto/project.json` (TYTO-536), under `aliases`, keeping the file's
comments and layout and adding the key when it is missing. Main writes only the open folder's
file, never a work profile's, and refuses a folder that is not trusted and a file that does not
parse.
