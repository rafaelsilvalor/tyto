---
'@tyto/editor': minor
---

TYTO-419 (ADR 0143 amendment): two more vim operations for a contribution to map, and a yank
flash. `sneak` is a normal-mode action that reads two keys and jumps to the next occurrence of
that pair in the buffer (`backward: true` for the previous one; a count picks the Nth; Escape
cancels), and `sneak.repeat` repeats the most recent find, sneak or `f`/`t` (`reverse: true`
for `,`). `vimMode()` now flashes the range a yank took for 200 ms; `setVimYankFlash(on)`
switches it for every editor of the window, and `onVimYank(view, listener)` reports each yank's
ranges, text and linewise.
