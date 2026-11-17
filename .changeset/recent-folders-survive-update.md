---
'@tyto/desktop': patch
---

The recent folders survive an update (TYTO-558): a new version's first run brings
`recent-folders.json` from the version before when the person chooses **Bring them**, as it
already brought the recent files. Until now every update started the title bar's folder list
empty, so it looked as if it kept only the last folder opened.
