---
'@tyto/desktop': minor
'@tyto/io': minor
---

TYTO-347: the window shows the work profile an open folder names (ADR 0114). The trust strip has a line of its own for an untrusted profile that left something out, with **Trust this profile**, and a third button, **Show project**; Workspace: Manage Trust shows the profile with its own two buttons, none for a profile kept in `TYTO_HOME`. A profile's problems are listed in the problems panel with its file in front. Workspace: Show Project opens a read-only Project panel beside Problems listing `assets`, `templates`, `fonts` and `output`, each with its folders and `profile <name>`, `this folder` or `not set`. `workspace:trust` now takes a strict `source` (`folder` or `profile`) and still no path. `@tyto/io`'s `LoadedProfile` says whether it is trusted by where it lives (`byLocation`).
