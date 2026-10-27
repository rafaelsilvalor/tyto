# 0142 — A vim contribution maps keys onto text objects

Status: accepted · 2026-10-26 · TYTO-422 · amends ADR 0141 · measured in TYTO-420
(`docs/explorations/2026-10-26-vim-text-objects.md`) · decision 2's last sentence amended for the
`engine` operation kind by ADR 0143's 2026-10-26 amendment (TYTO-418)

## Context

ADR 0141 lets a plugin map vim keys onto an operation `@tyto/editor` names, of kind `action` or
`operator`. Batch `vim-plugins` also wants text objects: vim-indent-object's `ii`/`ai`,
textobj-entire's `ie`/`ae`, and later targets-style objects. `@replit/codemirror-vim` 6.4.0 has
no API for a new object. Its own objects are one motion, `textObjectManipulation`, behind the
keymap entries `i<register>` and `a<register>`, with a closed `if` chain inside.

TYTO-420 measured that a text object in this engine **is** a motion: one registered with
`Vim.defineMotion` that returns `[anchor, head]`, mapped with the engine's `motion` type in
`visual` and `operatorPending`, gave the built-in result for `vii`, `dii`, `cii`, `d2ii`,
`2dii` and `.` after `dii`/`cii`. It also measured the one form that cannot work: `din(` never
reached its motion.

## Decision

1. **A third operation kind, `textObject`.**
   `{ kind: 'textObject', select(view, head, args, count) → { from, to, linewise } | undefined }`.
   `head` is the cursor as an offset, `args` the mapping's own args (`{ inner: true }` on the `i`
   spelling, as surround's args are the plugin's), `count` the repeat typed before the operator
   or the object. `linewise` means the whole lines `from` and `to` fall on; otherwise `to` is
   exclusive. `undefined` means no object here, and the cursor stays, as the built-in objects do.
   The kind keeps the name `textObject` although the engine type is `motion`: what a plugin
   author maps is an object, and a plain motion kind can be added later without a rename.

2. **`defineVimOperation` registers it with `Vim.defineMotion` under the `tyto:` prefix**, and
   `setVimContributions` maps it with the engine type `motion`. The adapter converts offsets to
   the engine's `{ line, ch }`, ends a charwise object in visual mode on its last character (a
   visual head is inclusive), and does the linewise bookkeeping the engine's `ip` does: it marks
   the motion's args linewise, and sets `visualLine` in visual mode or the pending operator's
   `linewise` otherwise. An operation never touches engine state.

3. **`setVimContributions` refuses, as `E_VIM_CONTRIBUTION` (ADR 0141 §5):**
   - a text object mapped in `normal`, in `insert`, or with no context. In normal mode the
     object would be a cursor jump, and `i` or `a` alone already wins there. An absent context
     would cover `visual` and `operatorPending` too, but it would hide what is mapped, so a
     contribution names both contexts;
   - **any mapping, of any kind, whose keys are `i` or `a` followed by two keys or more**, in
     every context but `insert`. `i<register>` and `a<register>` take any one key after `i` or
     `a`, so after the second key they are a full match while `in(` is a partial one, and the
     engine's dispatcher takes a full match over a partial one. A two-key mapping such as `ii`
     is reachable: a mapping is put ahead of the defaults, both are full matches, and the first
     full match wins. The card described the form as `i`/`a` + letter + more; the engine accepts
     any key in that position, so `a,x` is refused too. A test keeps the measurement (a mapped
     `in(` motion runs 0 times), so an engine that changes the rule turns it red.

4. **The editor ships two text objects**, registered by the first `setVimContributions` call
   rather than on import (the package has no import side effects):
   - `indentObject`: `ii` is the run of lines at the cursor's indent or deeper; `ai` adds the
     nearest non-blank line above with a smaller indent, the line that opens the block. Each
     count past the first climbs one level, to the block around that opening line, and stops
     at the top level. **Blank lines inside the block are included; blank lines at its edges
     are not**, so `dii` on a block followed by a blank line keeps the line that separates it
     from the next one. A cursor on a blank line starts from the next line with text, or the
     previous one at the end of the document. Indent is counted in columns, a tab reaching the
     next tab stop.
   - `entireBuffer`: `ae` is every line; `ie` leaves blank lines at either end out. The count
     changes nothing.

   Both are linewise. Which keys they sit on, and the switch in `settings.json`, belong to the
   built-in plugin's contribution (TYTO-419), not to the editor.

## Consequences

- A plugin can add an object only by mapping keys onto one the editor has, as with actions and
  operators. A new object is code in `@tyto/editor`.
- Three-key targets objects (`in(`, `il(`, `an"`) stay out of reach on 6.4.0. They need an
  upstream change to the dispatcher or a text-object registry; TYTO-420 found no issue or PR.
- `.` after a visual `vii` then `d` repeats the same number of lines and does not run the object
  again, which is vim's own rule for a visual operator; `yii` leaves the cursor where it was,
  as the engine's `yip` does. Both are the engine's.
- Behaviour in the real window (`j` after a delete, how the linewise selection is drawn) is not
  measured: jsdom has no layout. It belongs to the card that ships the built-in contribution.
