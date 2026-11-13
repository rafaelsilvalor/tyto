# 0195 — A recipe's blocks are a reading of its text, framed over the one editor

Status: accepted · 2026-11-12 · TYTO-676 · amends ADR 0148 decision 2 and ADR 0074 decisions 2
and 6 · builds on ADR 0128, ADR 0141, ADR 0143, ADR 0171 and ADR 0176 · decision 1 superseded
and decisions 2, 4, 5, 6 and 8 refined by ADR 0196 (2026-11-13)

## Context

The recipe notebook (TYTO-377, ADR 0148) is one CodeMirror editor with each step's result drawn
under its line. The maintainer asked on 2026-11-11 for it to work like a Jupyter notebook, with
blocks, and on 2026-11-12 chose eight behaviours for the first version: a toolbar per block (run,
up, down, delete); a "+" between blocks opening TYTO-402's step picker; drag to reorder; note
blocks saved as comments; collapsing a block's result; Jupyter's command-mode keys; an execution
counter with a stale marker; and run all / run from here down. ADR 0176 decision 1 stands over
all of it: the text is the source of truth.

Read in the code on 2026-11-12, before deciding:

- **A step is always one line.** `parseRecipe` skips a blank line and a `#` line, reads the
  header lines (`recipe`, `|`, `apply`, `every`, `param`), and takes every other line as one verb
  and one cell. There are no continuation lines.
- The results are block widgets under their lines (`cell-outputs.ts`), and every per-cell state
  the window keeps — folds, opened `run` cells, a view's filter, a full-size tab's cell — is keyed
  by the start of its line and follows it through each edit (TYTO-451, 639, 642).
- A run starts at the first changed cell, or at `from`, and stops where the policy says
  (`runPolicy`); every cell after the stop is `stale` and reruns on the next run.
- CodeMirror's default keymap binds Shift-Enter to a new line; the vim engine maps no `<C-m>`, and
  in normal mode lets `<Esc>` fall through to the bindings after it.

The card lands in four pull requests: (A) this record, the block model, the frames and the toolbar
with Run this block and folding; (B) "+" between blocks, note blocks, the counter and the stale
marker, run all and run from here on the toolbar; (C) command mode; (D) drag to reorder.

## Decision

1. **A block is a reading of the text, by line.** `recipeBlocks(text)` in `@tyto/recipe` reads
   each line by its first word, never through the parser, so a text that does not parse still has
   blocks: a **header** block is a run of header lines; a **step** block is one step line, one
   cell, its index the cell's; a **note** block is a run of `#` lines; a blank line belongs to no
   block and stays where it is. A header block is never moved, deleted or passed by a move: `apply`
   and `every` belong before the first step, and every step reads the `param` lines.

   _Superseded 2026-11-13 (TYTO-676, ADR 0196):_ a block is a run of lines between blank lines,
   which may hold several steps and `#` lines, and shows its last step's result.

2. **Every block action is one edit of the text, dispatched to the editor.** Move swaps a block
   with its movable neighbour, the blank lines between them staying put; delete takes the block's
   lines and one line break. Each is a list of changes applied as one transaction, so one undo
   takes it back, the second pane follows, and saving writes the text as it stands: **the saved
   file is the blocks in their order, byte for byte** (a property test moves every block of a text
   with `\n` and `\r\n` endings and checks that every line and every byte outside the two blocks
   is kept). **A move rewrites the neighbour, not the block moved**: an editor drops the marks of a
   line an edit deletes, so the block the person moved keeps its result and its fold.
3. **Blocks are frames over the one editor**, not a view of their own. `notebookFrames()` in
   `@tyto/editor` draws, from the host's reading of the text as it is now, a class on each of a
   block's lines (its kind, its first and last line, the block holding the caret), read again on
   every edit. Vim, search, undo, the second pane and every state keyed by line stay as they are.
   One editor per block was weighed and refused: it splits the history and vim per block and
   reopens ADR 0148's one editor.
   **A toolbar is drawn in a layer beside the text, never in a line**, as CodeMirror draws the
   selection: a line's text, what a screen reader names it and what a test reads of it hold the
   line alone. The first version put it in the line as an inline widget, and every reader of a
   line's text read `▶↑↓✕` before it (TYTO-377's `recipe-tab` suite, red on CI). The layer is
   not hidden from a screen reader, as CodeMirror's own layers are, since its buttons are the
   person's; it spans the visible width, so a toolbar never widens what scrolls. **A toolbar's
   top is read from its line's element, not from the height map**: a result folded in place
   shrinks a block widget that the map goes on counting at its old height (measured in the
   window: a line drawn at 170 px that `lineBlockAt` put at 243).
4. **The toolbar is always shown**, at the right of a block's first line (TYTO-377: a person sees
   what a block offers before reaching for it): Run this block on a step, Up, Down, Delete, and
   Fold on a step whose result folds. It finds its block where its element sits when clicked, not
   where it was built, and a click on it leaves the caret where it was. Delete asks nothing: undo
   brings the block back.
5. **Run this block runs from the first changed cell to that block, and no further.** It is Run
   (`explicit`), with `from` and a new `until` on `recipe:run`, both the block's cell: the runner
   stops at `min(stop, until + 1)`, so the block reruns even when nothing above it changed, as a
   notebook's cell does, and the cells below it are `stale`. **The window says why**: it knows the
   request it sent, so a stale cell below the block run reads "Below the block run", not the
   error that a stale cell with no reason means otherwise. Nothing crosses the wire for it.
6. **Folding is a result's, whatever the result is.** A table, a view, a plan's lines and a `run`
   cell's included cells all fold under the result's header. The block's toolbar presses the
   result's own toggle, so the two are one control with one state, kept by line as before.
7. **Command mode is focus on a block's frame, not in its text** (pull request C). Command-mode
   keys are handled on a focusable element outside `.cm-content`, where neither CodeMirror nor
   vim listens; the text gets no key of theirs. Escape enters it in the desktop input mode, below
   CodeMirror's own uses of Escape; **Shift+Escape** in vim, where plain Escape stays the
   engine's, because a vim user presses it by habit and `d d` in command mode deletes a block;
   Ctrl+M in both. Escape in command mode does nothing; Enter edits; Shift+Enter runs and moves
   down, and in edit mode does so on a recipe tab only.
8. **The counter and the stale marker are the window's** (pull request B): per tab, never sent
   to main, never written, forgotten when the tab closes, and keyed by line as folds are. The
   cells whose `ranAt` is the answer's take the next numbers in cell order.

### What this amends

- **ADR 0148 decision 2:** `recipe:run` carries `until`, the cell a run stops after; a cell after
  it is `stale` with no `held`. The renderer's own state, never sent nor written, gains the
  counter of decision 8, and the fold covers every result (decision 6).
- **ADR 0074 decisions 2 and 6** (pull request C): a seventh context, `notebook`, is focus on a
  block's frame, and a key with no modifier is valid under it as under `vim.*`, since nothing is
  typed there.

## Consequences

- A block is wherever its lines are: there is no block list to keep in step with the text, and
  an edit by hand, by a form (ADR 0176) or by a toolbar reads the same.
- A note is a comment, so a recipe written before blocks has its notes already, and the CLI runs
  a recipe with notes as it always did.
- A `param` line written between steps is a header block in the middle, which no move passes;
  moving a step across it is done by hand.
- The toolbar sits over the right end of its line's band; a step line longer than the pane runs
  under it. A block's first line is padded so a typical step clears it. Scrolled sideways, the
  toolbars keep to the visible width at the moment they were drawn, until the next redraw.
- Open: CodeMirror's height map keeps a folded result at its unfolded height (measured above),
  which this record works around for the toolbars only; what else reads the map was not
  measured.
- Open: the result of the neighbour a move rewrites disappears until the next answer, which the
  move itself triggers, since it changes the chain.

## Notes from the build

- 2026-11-12 (second pull request): **the "+" between blocks** is drawn in a layer of its own,
  as the toolbars are, above every block but the header and below the last; it offers Step…,
  TYTO-402's picker and form writing their line on a line of its own at that boundary, and
  Note, a `# ` line with the caret after it. It sits just left of the toolbars' column, not in
  the middle, where it sat on a result's buttons in the window. A note reads as prose: the
  window's font, in the comment colour, on no band.
- 2026-11-12 (second pull request): decision 8 is built as **a gutter at the left** showing
  `[n]`, `[*]`, `[ ]` and a stale `[n]` (dimmed, italic, with its reason on hover). The cells an
  answer ran are those carrying the answer's own `ranAt`: they take the next numbers in cell
  order, and a cell main reused keeps its number. **A run a pause in typing started numbers
  the cells it ran as a button's does**, so the counter holds whichever way the open question
  of running while typing is answered (ADR 0148 decision 3 is unchanged). Stale is what main
  would run again: from the first step whose text changed (every step on a header or `param`
  change), or from the first cell not `ok`. `[*]` covers that same reach, from `from` to
  `until`, while a run is on its way; the window cannot know where main stops for a source
  until the answer, which settles it.
- 2026-11-12 (second pull request): **Run from here down** joins a step's toolbar and **Run
  all** the header's; they are Run from here and Run recipe.
- 2026-11-12 (second pull request): measured in the end-to-end suite's window, which is never
  shown (`TYTO_HEADLESS`): a `requestAnimationFrame` there did not fire in 500 ms, so the layers,
  drawn on CodeMirror's measure, drew only when something read the layout. The suite runs that
  measure before it reads where a toolbar or a "+" is; a shown window draws them on the next
  frame.
