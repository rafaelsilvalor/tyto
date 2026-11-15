# 0196 — A recipe's block is a run of lines between blank lines and shows its last step's result

Status: accepted · 2026-11-13 · TYTO-676 · supersedes ADR 0195 decision 1 · refines ADR 0195
decisions 2, 4, 5, 6 and 8 · amends ADR 0176 on Add step

## Context

ADR 0195 read a recipe's blocks by line: one block per step line, a run of `#` lines as a note,
a run of header lines as a header. Its first two pull requests (TYTO-676, #444 and #445) drew
those blocks, their toolbars, the "+" between them and the execution counter.

On 2026-11-13 the maintainer looked at it and decided that **a block is like a Jupyter cell**:
it holds several lines, a blank line separates one block from the next, and it shows only its
last step's result. A step is still one line; the `|` chain written over several lines is a
later card.

Read in the code on `origin/main` (`cdaabe01`) before deciding:

- Main runs every step and keeps every cell's result (ADR 0148); the window decides what it draws
  under which line (`cellStatuses`, then `setCellOutputs`). A step's diagnostics reach the editor
  and Problems from the answer, not from the drawn outputs.
- A run stops where the policy says, and `until` (ADR 0195 decision 5) stops it after a cell.
  When a step fails, the cells after it come back `skipped`.
- Every per-cell state the window keeps (folds, opened `run` cells, a view's filter, a full-size
  tab's cell, the counter) is keyed by the start of a cell's line.
- The end-to-end fixtures of six suites write their steps on consecutive lines.

## Decision

1. **A block is a run of consecutive lines that are not blank.** `recipeBlocks(text)` stays a
   reading by line and by first word, never through the parser. A block may mix steps and `#`
   lines; **a block made only of `#` lines is a note block** (no run button, no counter). The
   recipe's leading run of `recipe`, `|`, `apply`, `every` and `param` lines is **the header
   block even with no blank line after it**: a step written right under `recipe x` starts a
   block of its own, and the header is never run, moved or deleted. A `param` line further down
   is a line of its block, and still a header line to everything that reads the header (the
   counter's stale rule); a block made only of such lines is a header block, which no move
   passes. `RecipeBlock.step` becomes `steps: { first, last, lastFrom }`.
2. **A block draws one result: its last step's**, under that step's line. Main and the wire do
   not change: every step runs and keeps its result. The window filters what `cellStatuses`
   answers to each block's last cell (`blockResults`); the cells above it in the block draw
   nothing. **A step's diagnostics still mark its own line and show in Problems.** A failed
   middle step leaves the last step `skipped`, so the block reads "Skipped: a cell above failed"
   with the failing line marked. Open cell result in a tab, from the cursor's line, still opens
   any step's result.
3. **Every block action acts on the whole block.** Run this block runs from its first step to
   its last (`from` and `until`, ADR 0195 decision 5), so every step of the block reruns as a
   notebook's cell does. Run from here down starts at the block's first step. Up, Down and
   Delete move or take all of the block's lines; Delete takes the blank line that set it apart,
   so one blank line still separates the blocks around it. The "+" writes **a new block**, set
   apart by a blank line.
4. **The counter and the fold are the block's, read from its steps.** A run that reaches a block
   gives it one number, which every step of it that ran shares, so a block of three steps counts
   one run, not three. The counter shows the block's latest number; `[*]` when a run reaches any
   step of the block; stale when any step is not as it ran, a step skipped after a failure
   included; `[ ]` when no step of it ever ran. The fold is the last step's result's, keyed by its
   line.
5. **Add step joins the cursor's block** (amends ADR 0176 decision 1, whose form wrote below the
   cursor's step, as TYTO-402's code did without the record saying so): with the
   cursor inside a block, the step is written at the block's end, the block grows by a step and
   its result becomes the new step's. With the cursor on a blank line, it writes a new block
   after the block above. With the cursor in the header, above every block, or with none, it
   writes a new block at the end of the text, as Add step wrote from above every step before: a
   new recipe opens with its cursor in the header, and its skeleton's note ("Each line below is
   one step") stays above the steps added.

## Consequences

- A recipe written before this record with no blank lines between steps is one block and shows
  one result. Its steps still run and their problems still show; a blank line between two steps
  brings back a result under each. The six end-to-end suites that wrote steps on consecutive
  lines now put a blank line between them.
- The intermediate results are computed and hidden: a person reads them by splitting the block
  with a blank line, or with Open cell result in a tab.
- A step picked with Add step after another one, the cursor still on it, joins its block: a
  recipe built with the picker alone is one block until a blank line is typed.
- PR C of TYTO-676 (command mode) is rebased on this record: its block actions act on whole
  blocks and its fixtures need the blank lines.

## Notes from the build

- 2026-11-13 (TYTO-676, command mode, ADR 0195 decision 7): **command mode selects a whole
  block**, all its lines marked. A and B write a new block above or below it, a blank line
  apart; D D deletes all its lines and the blank line that set it apart; Enter puts the caret at
  the end of its first line; Shift+Enter runs every step of it, first to last, and selects the
  next block, or, in the text, moves the caret to the end of the next block's first line; O
  folds its result, its last step's. Measured in the window with vim on: Escape twice and `dd`
  on a line of a two-line note delete that line, and the block stays.
- 2026-11-13 (TYTO-706): **a `|` standing alone chains steps on one line.** On a step line, a
  `|` with a blank or the line's edge on both sides, outside a double-quoted string and outside
  `{ }`, splits the line into steps, each read exactly as if on its own line of the same block:
  `where status != done | sort due | show table` is three steps, three cells, and the block
  shows the last one's result. Each step's ranges, and so its diagnostics, are its own
  segment's. **`a|b` never splits**: `|` already means a header description line, a pattern's
  alternation and a template's filter, and main accepts unquoted patterns
  (`pattern=^(poster|flyer)`), whose `|` touches its words, as a filter's does
  (`{team|upper}`). A `|` with no step after it, and a header word or `#` after a `|`, are
  `E_RECIPE_SYNTAX`; a header line is never split. `recipeSteps(text)` in `@tyto/recipe` gives
  each step's place, its index being its cell's, and `recipeBlocks` counts a block's steps by
  segment; the window's counter and stale marks read one mark per step from it, and a line's
  drawn result is its last cell's. A step's per-line state (fold, counter, a tab's cell) stays
  keyed by its line's start, which a chained line's steps share.
- 2026-11-14 (TYTO-711): **on a chained line, Edit step and Open cell result in a tab act on the
  step under the cursor**, not the line's first. Inside a step's text, or touching either end of
  it, that step; on the `|` or the blanks between two steps, the step after the `|` when the
  caret is after it, else the step before; before the line's first step, the first; past its
  last, the last. A one-step line answers its step wherever the caret is, as before.
  `stepIndexAt` in the window's `recipe-notebook.ts` holds the rule over `recipeSteps(text)`. A
  full-size tab keeps, beside its line's start, which of the line's cells it was opened for, the
  first being 0, so a tab opened from a block's toolbar on a chained line draws its last step's
  cell; when the line holds fewer cells after a run, the tab has no result rather than another
  step's. Run from here still starts at the cursor line's first step.
