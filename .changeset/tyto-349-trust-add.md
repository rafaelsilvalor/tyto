---
'@tyto/cli': minor
'@tyto/io': minor
---

TYTO-349: the command line can trust a workspace folder for good. `tyto trust add <folder>` prints what the folder does while restricted (a key that leads outside it, withheld plugin sections, its profile's problems), then writes the approval to `TYTO_HOME/trust.json` under the folder's real path, with no y/N prompt so a script can run it. It refuses a path that does not exist and the folder whose `.tyto` is `TYTO_HOME` (ADR 0112), accepts a folder with no project file, and says which `tyto trust add <file>` trusts the work profile the folder names. `tyto trust add <file>` trusts a shared profile file on its own (ADR 0114); one inside `TYTO_HOME` is already trusted by where it lives. `tyto trust list` prints each approval with its date and marks one whose path is gone. `fsTrustStore` in `@tyto/io` gains `list()`, off the core `TrustStore` port.
