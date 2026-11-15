---
'@tyto/desktop': minor
---

The command panel has file commands that write (TYTO-537, ADR 0201): `new` and `mkdir` make a
file or a folder (`new x.brief --template t` writes the template's skeleton), `mv` moves or
renames and `cp` copies, never over what is there, `rm` sends to the system's bin only, `open`
opens a file in a tab and `reveal` selects it in the Explorer. Each goes through the Explorer's
own writes, checked by main at the call; none runs in a restricted folder.
