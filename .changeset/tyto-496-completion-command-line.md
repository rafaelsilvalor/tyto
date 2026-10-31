---
'@tyto/command-line': minor
---

The command tree says what each argument and option takes, for the window's completion (TYTO-496): `commandTree` gives each option its long and short flag, whether it takes a value, and, where `program.ts` says so beside the definition, the kind of value (a brief, a file, a folder, a template, format ids, output types with the built-in four as choices, or a plugin). `valuesOf` refuses a name the command does not declare, so a renamed option fails when the program is built. Nothing a command accepts or refuses changes.
