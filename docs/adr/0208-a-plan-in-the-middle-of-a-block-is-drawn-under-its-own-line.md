# 0208 — A plan in the middle of a block is drawn under its own line

Status: accepted · 2026-11-17 · TYTO-766 · amends ADR 0196 decision 2

## Context

ADR 0196 made a recipe's block show only its last step's result: the other steps run, their
problems are marked, and nothing is drawn under them. ADR 0199 already made one exception, the
values a `set` step sets, which the block's result carries.

On 2026-11-17 the by-hand acceptance of TYTO-421 ran a company recipe written as one block:
`google.sheet-rows`, `jira.refresh`, `run status-rule`, `jira.transition`, `select`,
`google.sheet-sync` (desktop 0.23.2). `jira.transition` planned two transitions, but its plan
and its Apply were nowhere on screen; the only Apply drawn was the sheet's. The maintainer
clicked it: the sheet took the new status, Jira did not move, and the state store (ADR 0140)
advanced only the row whose write was applied. A blank line under `jira.transition` showed the
plan, and the run then passed.

That breaks ADR 0129: a write verb plans first and applies on confirmation, and a plan nobody can
see cannot be confirmed. The maintainer's direction: the fix belongs in how a block works, not in
the recipes.

Read in the code on `origin/main` (`10e44414`) before deciding:

- `blockResults` in the window's `recipe-notebook.ts` drops every status but the block's last
  step's. Main still runs every step and keeps every plan (ADR 0148).
- Apply names a cell by index and a plan by id (`apply(index, planId)`); nothing in it reads which
  line the cell is drawn under.
- An output's key holds its cell's index, so two outputs under one line, a chained line's
  (TYTO-706), are two widgets. The fold and a view's state are keyed by the line's start.

## Decision

1. **A step in the middle of a block that answered a plan is drawn under its own line**, with
   its plan, its operations and its own Apply, exactly as a step that is a block of its own.
   The block's last step's result stays under the last line. A middle step with a table and no
   plan stays hidden, as ADR 0196 says.
2. **On a chained line** (`a | b`), a plan of a step before the line's last is drawn under that
   line, before the line's last step's result. The two outputs share the line's fold.
3. **There is no Apply all.** Each plan keeps its own Apply, so each is read and confirmed on
   its own (ADR 0129), and the state commits from each plan's outcome as ADR 0170 says. A block
   that plans twice asks for two clicks, both on screen.
4. **The block's fold folds its last step's result only.** A middle plan has its own toggle, so
   folding the block never hides a plan the person has not folded.
5. Nothing changes on disk: a recipe written as one block works as written, and
   `tyto recipe run`, which prints every cell, is unchanged.

## Consequences

- The TYTO-421 recipe, as one block, shows the Jira plan under `jira.transition` and the sheet
  plan under `google.sheet-sync`.
- A block whose steps plan nothing looks exactly as before.
- A block is no longer one drawn result in every case: a frame may hold a plan between its lines.
  That is the price of never hiding a write.
- The manual's recipe page says where a middle step's plan appears, in both editions.
