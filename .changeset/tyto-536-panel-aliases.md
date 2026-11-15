---
'@tyto/desktop': minor
'@tyto/core': minor
---

The command panel has aliases and variables (TYTO-536). `alias entrega='render --delivery'`
saves an alias in the `commandAliases` setting, and `unalias` removes one; a workspace's own
aliases, in the new `aliases` key of `.tyto/project.json`, win name by name.
An alias expands once and its line is taken literally. `set name=value` sets a variable for the
session, read as `$name` inside a word, never in single quotes and never from the environment.
A restricted folder's aliases are withheld (`W_PROJECT_ALIASES_WITHHELD`), and a refused line
that came from an alias names it, and where it is defined, in its sentence and its box.
