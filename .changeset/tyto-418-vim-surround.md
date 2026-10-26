---
'@tyto/editor': minor
'@tyto/desktop': minor
---

TYTO-418 (ADR 0143 amendment): vim mode gains surround, on by default and switched by the
`surround` id of `vimPlugins`. `ys{motion}{pair}`, `yss{pair}`, `ds{pair}`, `cs{old}{new}` and
visual `S{pair}` add, delete and change brackets or quotes around text; an opening bracket adds
a space inside, and `.` repeats with the same pair. `@tyto/editor` ships it as two operations,
an `s` motion after an operator that reads the operator before it and a `surround.add`
operator, through a new `engine` operation kind, and reads the pair from the keyboard ahead of
the engine. The desktop's built-in plugin contributes `s` in operator-pending mode and visual
`S`. The manual's Vim mode page and the settings reference describe it, in English and
Brazilian Portuguese.
