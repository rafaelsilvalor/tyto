---
'@tyto/desktop': patch
---

The command panel refuses `tyto recipe run --apply` with a line naming the notebook's Apply button and a terminal: the window's panel only plans a recipe (TYTO-684). `recipe run` without `--apply` still runs and prints its plans.
