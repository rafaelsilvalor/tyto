# 0094 — The sticky header reads the grammar's fold ranges

Status: accepted · 2026-10-17 · TYTO-295

## Context

A `::lamina` in a real brief runs for dozens of indented lines; once its head line scrolls out of
the pane nothing on screen says which block the reader is in. VS Code and Zed answer this with
"sticky scroll": the head line of every block the top of the pane is inside stays pinned there.
`packages/editor` had nothing of the kind.

The card assumed a brief nests. It does not today: a directive's body is text, so in a brief at
most one line can be pinned. What nests is the template mode's markup — elements in elements, CSS
rules in a stylesheet — whose folds `template-language.ts` already declares (`Element`,
`StyleSheet`, `Block`, `NestedBlock`). Rafael (2026-10-16): a brief may one day hold several
templates and nested blocks, so the feature must not assume depth one.

Three ways to draw a pinned row were weighed. `showPanel` shrinks the scroller, so the text jumps
a line each time a row appears or goes. CodeMirror's `layer()` is positioned in the content and
scrolls with it. An overlay inside `view.dom`, placed where the scroller starts, does neither.

## Decision

**1. Which lines pin is the grammar's answer, through `foldNodeProp`, not the text's indent.**
`stickyChain(state, pos)` in `packages/editor/src/sticky-scroll.ts` walks from the innermost node
at `pos` up its parents and keeps every node whose fold range contains `pos` and whose head line
is above it. A folded block pins nothing; a language that folds nothing (the JSON tabs) pins
nothing. **A brief whose blocks nest will stack its rows with no change to this module** — the
template mode's two-row stack is the proof that the multi-level path works.

**2. The chain grows under the rows, VS Code's algorithm.** The chain at the line at the pane's
top, then the chain at the line just under the rows, until it stops growing; at most five rows
and never more than a third of the pane. A row is pushed up as its block's last line reaches it.

**3. An overlay plus `scrollMargins`.** The rows are an absolutely positioned layer inside
`view.dom`, from the scroller's top (so under the find panel, a top panel) to the scrollbar.
`EditorView.scrollMargins` reports the rows' height, so every scroll CodeMirror makes to reveal
the caret — arrows, vim's `j`/`k`, search, go to line — keeps it below them. A scroll set directly
(vim's `zt`) does not ask for margins, so after the caret was last moved from the keyboard, the
row that would cover the caret's line is not drawn.

**4. A click goes to the block.** The caret goes to the start of the head line and the line is
scrolled to the top.

**5. `stickyScroll` is a setting, on by default** (`apps/desktop/shared/settings.ts`), delivered
on `theme:current` and applied through a compartment on every pane (`setStickyScroll`), as
`indentGuides` is (ADR 0088). Brief tabs and both template-mode buffers.

**6. No new token** (ADR 0081): the rows sit on `surface`, the line keeps its syntax colours, the
number is the gutter's colour, one `hairline` under the stack, `hover` under the pointer.

## Consequences

- The fold of a directive now ends at its last line with text (`foldDirectiveBody`), since a
  trailing blank `BodyLine` (TYTO-294) would otherwise keep the row pinned over empty lines, and a
  directive whose body is only whitespace no longer folds.
- The rows are redrawn from a measure on every scroll; the work is a tree walk per row and one
  highlighted line each.
- What `zt`/`zz` leave under the rows is hidden only after keyboard input; a wheel in between
  turns that off, so wheeling past the caret does not make the row blink.
