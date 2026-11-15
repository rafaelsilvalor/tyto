---
'@tyto/desktop': minor
---

The command panel has file commands that read (TYTO-537, ADR 0201): `ls` lists a folder with
each name's kind, `cd` moves the panel's folder and the prompt shows it
(`tyto entregas/novembro ›`), `pwd` prints it and `cat` prints a text file. `tyto` commands run in
that folder, and its paths link from there. Every path stays inside the open workspace folder,
checked by main on the explorer's ids, and the four run in a restricted folder.
