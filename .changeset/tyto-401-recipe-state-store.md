---
'@tyto/io': minor
---

TYTO-401: `recipeStateStore({ home, workspace, recipe })` keeps a recipe's state between runs (ADR 0140) in `TYTO_HOME/state/recipes/<identity>/<store>.json`, where the identity is the SHA-256 of the workspace's real path and the recipe's path inside it. A store never written reads as empty; a corrupt or oversized one (over 32 MiB) is `E_RECIPE_STATE` naming the file, never an empty store. A write deletes, then merges each put over its key's values, stamps it with the host's clock and replaces the file atomically; this process's writes to one store take turns, and across processes the last writer wins. No host composes it yet.
