---
'@tyto/desktop': patch
---

TYTO-331: in vim mode, Escape pressed right after typing goes back to normal mode on the first press. It used to stay in insert mode — 10 of 10 times in a visible window — because the key closed a completion that had not appeared yet. Escape on an open completion popup still only closes the popup. `keybindings.desktop.test.ts` now launches with `--disable-frame-rate-limit` (ADR 0104), which is what exposed this.
