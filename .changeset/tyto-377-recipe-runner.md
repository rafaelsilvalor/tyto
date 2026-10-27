---
'@tyto/desktop': minor
---

TYTO-377: the desktop runs a recipe in its main process, cell by cell, over `recipe:run` and `recipe:verbs`. It keeps each document's cells in memory and reruns from the first line that changed; a pause in typing stops before a source, which fetches on save or Run; a restricted folder runs only on Run, with its data files refused and its sections withheld; state is read and never written. The new `recipeTimeZone` setting names the IANA zone a recipe reads written times in (`null`, the default, is the machine's). No window draws the notebook yet.
