# 0146 — A recipe groups rows into one row per group, and the Summary view totals them

Status: accepted · 2026-10-27 · TYTO-382 · builds on ADR 0128 and ADR 0140

## Context

A team asks a recipe "how many tasks of each kind does each team have, and how many in all?".
The generic verbs filter, join and derive per row (ADR 0128); `rollup` (ADR 0140) counts
children onto a parent row that already exists. None collapses many rows into one, and nothing
draws a total. The notebook that draws views (TYTO-377) is not built yet, so whatever the
Summary view shows has to exist as a model that view can read later.

## Decision

1. **`group by=a,b [into=rows]` collapses the table to one row per group.** Its columns are the
   `by=` columns, with their type and origin, and `into=` (default `rows`), a `list` of the
   member rows' keys. Values compare with `comparable`, as `where` and `decide` compare them, so
   `anúncio`, `ANÚNCIO` and `Anuncio` are one group; the cell shows the spelling seen first. An
   empty cell is a group of its own, never dropped, and a list cell groups by its `cellText`.
   Groups come out in the order their first row appears; `sort` reorders them.
2. **A group row's key is the JSON of its compared values**, `["anuncio","design"]`: unique,
   never empty, and the same run after run even when the spelling seen first changes, so
   `remember` (ADR 0140) finds it again. Its provenance has `group` as its source, the key as
   its id, and the oldest `fetchedAt` among its members, since a group is only as fresh as its
   stalest row. The result passes `checkTable`.
3. **Grouping ends row identity.** After `group`, a row stands for no source item. An action
   or sink after it is not refused now; one that needs a source item will find no provenance it
   recognises.
4. **`count <list-column> [into=count]` writes the number of items of a list column**, generic:
   it counts a group's `rows` as well as an issue's labels. An empty cell counts 0. A column
   that is not a list is refused, and so is an `into=` the table already has. Grouping and
   counting are two steps on purpose: `group` has no `count=` shortcut.
5. **The grand total is a pure function, `summarize(table)`**, exported from `@tyto/recipe`:
   the rows as they are, and `totals`, the sum of each `number` column. It is not a row, which
   the next verb would count and a sink would write, and not a field of the run, because the
   notebook draws it from whichever cell it shows. It sums what is shown: after
   `where tasks >= 2` the total is of the groups left. Version 1 has a grand total only, no
   subtotals.
6. **`show summary` is `show`**: it names the view and validates nothing, as ADR 0128 leaves
   view names to the notebook.
7. **No new diagnostic code.** Bad arguments, an `into=` collision and `count` over a non-list
   are `E_RECIPE_ARGUMENTS`; an unknown `by=` column is `E_RECIPE_UNKNOWN_COLUMN` through
   `resolveColumn`. An empty table gives no group and totals 0, without a warning.

```
group by=kind,team
count rows into=tasks
select without=rows
show summary
```

## Consequences

- A recipe can answer a "how many per …" question, and the notebook's Summary view has its
  model before the notebook exists.
- Two more names enter the closed vocabulary, so the verb lists pinned in `@tyto/recipe` and
  `@tyto/plugin-api` tests change.
- Subtotals, averages and other aggregates are not here; each would be a new decision.
- An action after `group` is not guarded. If one turns out to write through a group row's
  provenance, refusing it is a later decision.
