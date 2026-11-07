---
'@tyto/core': minor
'@tyto/io': minor
---

A `TYTO_HOME` too deep for the copies fetched under it is now reported instead of crashing:
`E_TYTO_HOME_PATH_TOO_LONG` names the folder and the length of the longest path a fetch writes
there. The plugin files' sync checks it before the first fetch (on Windows a copy reaches the
home's length plus 172, against a limit of 259), and turns a path the system refuses under the
home (`ENAMETOOLONG`, or Windows' `ENOENT` over the limit) into the same error, as the gallery's
index fetch does. `tyto render`, `tyto plugin sync` and the gallery commands print it
(TYTO-470).
