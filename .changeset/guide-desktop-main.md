---
'@tyto/desktop': minor
---

Main writes a brief's external-art guides for the window (TYTO-741, ADR 0222): `guide:candidates`
lists each guide `tyto guide` would write, with whether it is there and newer than the brief, the
external slots the brief cites no file for and the line that would; `guide:write` runs
`tyto guide` in-process for the guides named, refuses a brief with unsaved edits, asks in a
native box before writing over a guide newer than the brief, and opens each guide in the program
the machine opens a PSD with, or shows it in its folder when no program does or the folder is
restricted. A brief's preview now compiles again when a file it asked for, a format's copy of its
art included, appears or changes in the open folder: `explorer:changed` names the burst's files.
