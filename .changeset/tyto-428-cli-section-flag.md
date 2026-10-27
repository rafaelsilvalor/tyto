---
'@tyto/cli': minor
---

TYTO-428: `tyto render --section <plugin>.<key>=<value>`, repeatable, sets one key of a plugin's section of `.tyto/project.json` for the run, over what the file says. The value is JSON when it parses and the typed text otherwise. It applies in an untrusted folder too, where the file's own sections stay withheld; a flag of another shape is a usage error (ADR 0147).
