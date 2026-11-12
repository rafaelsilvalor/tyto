---
'@tyto/recipe': minor
---

`decide` takes `clear=push|pull`. With `clear=push`, a value cleared in the local side since the last applied run pushes the empty value to the remote side (`_pushes` true, `_push` empty), and `tie=` settles it when the remote side changed too. `pull`, the default, keeps today's rule: an empty local value never pushes. The `decide` form lists the new choice.
